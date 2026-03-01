"""
Rightie Memory DB — SQLite + sqlite-vec storage layer.

Schema from Task 74, with review corrections:
- Hard delete (no active flag, no compressed_from)
- Per-agent private DB at ~/.openclaw/rightie/{agentId}/memories.sqlite
"""

import hashlib
import json
import shutil
import sqlite3
import struct
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# sqlite-vec: pip package ships wrong arch for aarch64.
# Try shared space first (works inside Docker sandbox), then host path.
_VEC0_CANDIDATES = [
    Path(__file__).parent.parent / "vec0",                      # shared/mind-theory/memory/vec0.so
    Path("/workspace/shared/mind-theory/memory/vec0"),          # inside Docker sandbox
    Path.home() / "ALS_Projects/Rain/rain-openclaw/node_modules/"
        ".pnpm/sqlite-vec-linux-arm64@0.1.7-alpha.2/node_modules/"
        "sqlite-vec-linux-arm64/vec0",                          # host dev path
]
VEC0_PATH = str(next((p for p in _VEC0_CANDIDATES if p.with_suffix(".so").exists() or p.exists()), _VEC0_CANDIDATES[0]))


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class Memory:
    id: str
    fact: str
    context: str
    emotional_tag: str  # neutral|positive|negative|important|breakthrough
    importance: float  # 0.0-1.0
    source_session: str
    source_turn: int
    created_at: int  # Unix ms
    last_accessed_at: Optional[int] = None
    access_count: int = 0
    compression_level: str = "original"  # original|compressed|anchor
    embedding: list[float] = field(default_factory=list)
    model: str = "text-embedding-3-small"


@dataclass
class Decision:
    agent: str  # 'librarian' | 'researcher'
    action: str  # 'store' | 'skip' | 'surface' | 'suppress'
    memory_id: Optional[str]
    session_key: str
    reasoning: Optional[str] = None
    input_summary: Optional[str] = None
    output_summary: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_memory_id(agent_id: str, fact: str, context: str) -> str:
    """SHA256(agent:fact:context:timestamp) — deterministic enough for dedup."""
    raw = f"{agent_id}:{fact}:{context}:{time.time_ns()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


def _serialize_f32(vec: list[float]) -> bytes:
    """Pack float list into raw bytes for sqlite-vec."""
    return struct.pack(f"{len(vec)}f", *vec)


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

EMBEDDING_DIMS = 1536  # text-embedding-3-small


class MemoryDB:
    def __init__(self, db_path: Path, readonly: bool = False):
        self.db_path = db_path
        if readonly:
            uri = f"file:{db_path}?mode=ro"
            self.conn = sqlite3.connect(uri, uri=True)
        else:
            db_path.parent.mkdir(parents=True, exist_ok=True)
            self.conn = sqlite3.connect(str(db_path))
        self.conn.enable_load_extension(True)
        self.conn.load_extension(VEC0_PATH)
        self.conn.enable_load_extension(False)
        if not readonly:
            self._create_tables()

    def _create_tables(self):
        c = self.conn
        c.executescript("""
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                fact TEXT NOT NULL,
                context TEXT NOT NULL,
                emotional_tag TEXT NOT NULL DEFAULT 'neutral',
                importance REAL NOT NULL DEFAULT 0.5,
                source_session TEXT NOT NULL,
                source_turn INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                last_accessed_at INTEGER,
                access_count INTEGER NOT NULL DEFAULT 0,
                compression_level TEXT NOT NULL DEFAULT 'original',
                embedding TEXT NOT NULL,
                model TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
            CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);
            CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(source_session);

            CREATE TABLE IF NOT EXISTS decisions_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                agent TEXT NOT NULL,
                action TEXT NOT NULL,
                memory_id TEXT,
                session_key TEXT NOT NULL,
                reasoning TEXT,
                input_summary TEXT,
                output_summary TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_decisions_ts ON decisions_log(timestamp);

            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)

        # Create vec0 virtual table (can't be in executescript)
        try:
            c.execute(f"""
                CREATE VIRTUAL TABLE memories_vec USING vec0(
                    id TEXT PRIMARY KEY,
                    embedding FLOAT[{EMBEDDING_DIMS}] distance_metric=cosine
                )
            """)
        except sqlite3.OperationalError:
            pass  # Already exists

        # Create FTS5 virtual table
        try:
            c.execute("""
                CREATE VIRTUAL TABLE memories_fts USING fts5(
                    fact, context, id UNINDEXED, emotional_tag UNINDEXED
                )
            """)
        except sqlite3.OperationalError:
            pass  # Already exists

        # Set meta
        c.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
            ("schema_version", "1"),
        )
        c.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
            ("embedding_model", "text-embedding-3-small"),
        )
        c.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
            ("embedding_dims", str(EMBEDDING_DIMS)),
        )
        c.commit()

    # -- Write --

    def find_similar(self, embedding: list[float], k: int = 3, min_similarity: float = 0.85) -> list[tuple[Memory, float]]:
        """Find memories above min_similarity. Returns (Memory, similarity) pairs."""
        if not embedding:
            return []
        rows = self.conn.execute(
            """SELECT id, distance FROM memories_vec
               WHERE embedding MATCH ? AND k = ?
               ORDER BY distance""",
            (_serialize_f32(embedding), k),
        ).fetchall()
        results = []
        for row_id, distance in rows:
            similarity = 1 - distance
            if similarity < min_similarity:
                continue
            mem_row = self.conn.execute(
                "SELECT * FROM memories WHERE id = ?", (row_id,)
            ).fetchone()
            if mem_row:
                results.append((self._row_to_memory(mem_row), similarity))
        return results

    def update_memory(self, memory_id: str, fact: str, context: str, embedding: list[float]):
        """Update an existing memory's fact, context, and embedding (for consolidation)."""
        self.conn.execute(
            "UPDATE memories SET fact = ?, context = ? WHERE id = ?",
            (fact, context, memory_id),
        )
        self.conn.execute("DELETE FROM memories_vec WHERE id = ?", (memory_id,))
        self.conn.execute(
            "INSERT INTO memories_vec (id, embedding) VALUES (?, ?)",
            (memory_id, _serialize_f32(embedding)),
        )
        self.conn.execute("DELETE FROM memories_fts WHERE id = ?", (memory_id,))
        self.conn.execute(
            "INSERT INTO memories_fts (id, fact, context, emotional_tag) VALUES (?, ?, ?, ?)",
            (memory_id, fact, context,
             self.conn.execute("SELECT emotional_tag FROM memories WHERE id = ?", (memory_id,)).fetchone()[0]),
        )
        self.conn.commit()

    def store_memory(self, mem: Memory) -> bool:
        """Store a memory. Returns False if near-exact duplicate (cosine > 0.95)."""
        if self.is_duplicate(mem.embedding):
            return False

        c = self.conn
        c.execute(
            """INSERT INTO memories
               (id, fact, context, emotional_tag, importance, source_session,
                source_turn, created_at, last_accessed_at, access_count,
                compression_level, embedding, model)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                mem.id, mem.fact, mem.context, mem.emotional_tag, mem.importance,
                mem.source_session, mem.source_turn, mem.created_at,
                mem.last_accessed_at, mem.access_count, mem.compression_level,
                json.dumps(mem.embedding), mem.model,
            ),
        )
        c.execute(
            "INSERT INTO memories_vec (id, embedding) VALUES (?, ?)",
            (mem.id, _serialize_f32(mem.embedding)),
        )
        c.execute(
            "INSERT INTO memories_fts (id, fact, context, emotional_tag) VALUES (?, ?, ?, ?)",
            (mem.id, mem.fact, mem.context, mem.emotional_tag),
        )
        c.commit()
        return True

    def is_duplicate(self, embedding: list[float], threshold: float = 0.95) -> bool:
        """Check if a very similar memory already exists."""
        if not embedding:
            return False
        rows = self.conn.execute(
            """SELECT id, distance FROM memories_vec
               WHERE embedding MATCH ? AND k = 1
               ORDER BY distance""",
            (_serialize_f32(embedding),),
        ).fetchall()
        if not rows:
            return False
        # vec0 returns cosine distance (0 = identical, 2 = opposite)
        # similarity = 1 - distance
        similarity = 1 - rows[0][1]
        return similarity >= threshold

    def delete_memory(self, memory_id: str):
        """Hard delete a memory."""
        self.conn.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
        self.conn.execute("DELETE FROM memories_vec WHERE id = ?", (memory_id,))
        self.conn.execute("DELETE FROM memories_fts WHERE id = ?", (memory_id,))
        self.conn.commit()

    # -- Read --

    def vector_search(self, embedding: list[float], k: int = 5, min_similarity: float = 0.3) -> list[Memory]:
        """Find top-k similar memories above min_similarity."""
        rows = self.conn.execute(
            """SELECT id, distance FROM memories_vec
               WHERE embedding MATCH ? AND k = ?
               ORDER BY distance""",
            (_serialize_f32(embedding), k),
        ).fetchall()

        results = []
        for row_id, distance in rows:
            similarity = 1 - distance
            if similarity < min_similarity:
                continue
            mem_row = self.conn.execute(
                "SELECT * FROM memories WHERE id = ?", (row_id,)
            ).fetchone()
            if mem_row:
                results.append(self._row_to_memory(mem_row))
        return results

    def vector_search_scored(self, embedding: list[float], k: int = 5, min_similarity: float = 0.3) -> list[tuple[Memory, float]]:
        """Like vector_search but returns (Memory, similarity_score) tuples, sorted by score descending."""
        rows = self.conn.execute(
            """SELECT id, distance FROM memories_vec
               WHERE embedding MATCH ? AND k = ?
               ORDER BY distance""",
            (_serialize_f32(embedding), k),
        ).fetchall()

        results = []
        for row_id, distance in rows:
            similarity = 1 - distance
            if similarity < min_similarity:
                continue
            mem_row = self.conn.execute(
                "SELECT * FROM memories WHERE id = ?", (row_id,)
            ).fetchone()
            if mem_row:
                results.append((self._row_to_memory(mem_row), round(similarity, 4)))
        return results

    def keyword_search(self, query: str, k: int = 5) -> list[Memory]:
        """FTS5 keyword search across fact + context. Returns up to k matches."""
        if not query.strip():
            return []
        # Extract meaningful words (skip short words and common stopwords)
        import re
        words = re.findall(r'\b\w{3,}\b', query.lower())
        if not words:
            return []
        # Use OR to match any keyword
        fts_query = " OR ".join(words[:10])  # Limit to 10 keywords
        try:
            rows = self.conn.execute(
                """SELECT m.* FROM memories m
                   JOIN memories_fts f ON m.id = f.id
                   WHERE memories_fts MATCH ?
                   ORDER BY rank
                   LIMIT ?""",
                (fts_query, k),
            ).fetchall()
            return [self._row_to_memory(r) for r in rows]
        except Exception:
            return []

    def mark_accessed(self, memory_id: str):
        """Update access tracking when a memory is surfaced."""
        now = int(time.time() * 1000)
        self.conn.execute(
            """UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1
               WHERE id = ?""",
            (now, memory_id),
        )
        self.conn.commit()

    def count(self) -> int:
        row = self.conn.execute("SELECT COUNT(*) FROM memories").fetchone()
        return row[0] if row else 0

    def all_memories(self) -> list[Memory]:
        rows = self.conn.execute("SELECT * FROM memories ORDER BY created_at DESC").fetchall()
        return [self._row_to_memory(r) for r in rows]

    # -- Decisions log --

    def log_decision(self, d: Decision):
        now = int(time.time() * 1000)
        self.conn.execute(
            """INSERT INTO decisions_log
               (timestamp, agent, action, memory_id, session_key, reasoning,
                input_summary, output_summary)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (now, d.agent, d.action, d.memory_id, d.session_key,
             d.reasoning, d.input_summary, d.output_summary),
        )
        self.conn.commit()

    # -- Backup/Restore --

    def backup(self, backup_path: Path):
        """Copy DB file for safe backup."""
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn.execute("PRAGMA wal_checkpoint(FULL)")
        shutil.copy2(self.db_path, backup_path)

    def close(self):
        self.conn.close()

    # -- Internal --

    def _row_to_memory(self, row) -> Memory:
        return Memory(
            id=row[0], fact=row[1], context=row[2], emotional_tag=row[3],
            importance=row[4], source_session=row[5], source_turn=row[6],
            created_at=row[7], last_accessed_at=row[8], access_count=row[9],
            compression_level=row[10],
            embedding=json.loads(row[11]) if row[11] else [],
            model=row[12],
        )
