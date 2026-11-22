from __future__ import annotations

import argparse
import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path


DEFAULT_DB = Path(__file__).with_name("investment_mvp.db")


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def connect(db_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS decision_cards (
            id TEXT PRIMARY KEY,
            symbol TEXT NOT NULL,
            action TEXT NOT NULL,
            reason TEXT NOT NULL,
            horizon TEXT NOT NULL,
            max_loss REAL,
            facts TEXT NOT NULL,
            inferences TEXT NOT NULL,
            counter_arguments TEXT NOT NULL,
            risks TEXT NOT NULL,
            invalidation_conditions TEXT NOT NULL,
            review_at TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            reviewed_at TEXT,
            review_note TEXT
        )
        """
    )
    return connection


def make_card(
    symbol: str,
    action: str,
    reason: str,
    horizon: str,
    max_loss: float | None,
    review_days: int,
) -> dict[str, object]:
    normalized_action = action.lower()
    if normalized_action not in {"buy", "sell", "watch"}:
        raise ValueError("action must be buy, sell, or watch")

    normalized_horizon = horizon.lower()
    if normalized_horizon not in {"short", "medium", "long"}:
        raise ValueError("horizon must be short, medium, or long")

    if review_days < 1:
        raise ValueError("review_days must be at least 1")

    if max_loss is not None and not 0 < max_loss <= 100:
        raise ValueError("max_loss must be between 0 and 100")

    reason_lower = reason.lower()
    facts = [
        "用户已提供交易方向和一条原始理由",
        "本版本尚未接入实时行情、财报或公告数据",
    ]
    inferences = [f"当前判断可能依赖于：{reason}"]
    counter_arguments = [
        "原始理由可能已经被市场价格反映",
        "当前没有外部数据验证该理由是否成立",
    ]
    risks = [
        "数据不完整风险",
        "估值和市场环境未经过验证",
        "单笔交易可能造成超出计划的损失",
    ]
    invalidation_conditions = [
        "出现与原始理由相反的公告或财务数据",
        "用户无法提供可验证的证据支持原始理由",
    ]

    if "业绩" in reason_lower or "利润" in reason_lower:
        invalidation_conditions.append("后续财报未显示预期的收入或利润改善")
    if "订单" in reason_lower:
        invalidation_conditions.append("订单金额或订单增速连续下降")
    if "估值" in reason_lower:
        counter_arguments.append("估值便宜可能反映了业务质量或增长风险")

    review_at = datetime.now(timezone.utc) + timedelta(days=review_days)
    return {
        "id": str(uuid.uuid4()),
        "symbol": symbol.upper(),
        "action": normalized_action,
        "reason": reason,
        "horizon": normalized_horizon,
        "max_loss": max_loss,
        "facts": facts,
        "inferences": inferences,
        "counter_arguments": counter_arguments,
        "risks": risks,
        "invalidation_conditions": invalidation_conditions,
        "review_at": review_at.replace(microsecond=0).isoformat(),
        "status": "open",
        "created_at": utc_now(),
    }


def save_card(db_path: Path, card: dict[str, object]) -> None:
    with connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO decision_cards (
                id, symbol, action, reason, horizon, max_loss, facts,
                inferences, counter_arguments, risks, invalidation_conditions,
                review_at, status, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                card["id"], card["symbol"], card["action"], card["reason"],
                card["horizon"], card["max_loss"], json.dumps(card["facts"], ensure_ascii=False),
                json.dumps(card["inferences"], ensure_ascii=False),
                json.dumps(card["counter_arguments"], ensure_ascii=False),
                json.dumps(card["risks"], ensure_ascii=False),
                json.dumps(card["invalidation_conditions"], ensure_ascii=False),
                card["review_at"], card["status"], card["created_at"],
            ),
        )


def list_cards(db_path: Path) -> list[dict[str, object]]:
    with connect(db_path) as connection:
        rows = connection.execute(
            "SELECT id, symbol, action, reason, horizon, status, review_at, created_at FROM decision_cards ORDER BY created_at DESC"
        ).fetchall()
    return [dict(row) for row in rows]


def review_card(db_path: Path, card_id: str, note: str) -> None:
    with connect(db_path) as connection:
        cursor = connection.execute(
            "UPDATE decision_cards SET status = 'reviewed', reviewed_at = ?, review_note = ? WHERE id = ?",
            (utc_now(), note, card_id),
        )
        if cursor.rowcount == 0:
            raise ValueError(f"decision card not found: {card_id}")


def print_card(card: dict[str, object]) -> None:
    print(json.dumps(card, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Investment decision quality MVP")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create", help="create a decision card")
    create.add_argument("symbol")
    create.add_argument("--action", choices=["buy", "sell", "watch"], required=True)
    create.add_argument("--reason", required=True)
    create.add_argument("--horizon", choices=["short", "medium", "long"], default="medium")
    create.add_argument("--max-loss", type=float)
    create.add_argument("--review-days", type=int, default=7)

    subparsers.add_parser("list", help="list decision cards")

    review = subparsers.add_parser("review", help="review a decision card")
    review.add_argument("id")
    review.add_argument("--note", required=True)

    args = parser.parse_args()
    if args.command == "create":
        card = make_card(args.symbol, args.action, args.reason, args.horizon, args.max_loss, args.review_days)
        save_card(args.db, card)
        print_card(card)
    elif args.command == "list":
        print_card(list_cards(args.db))
    elif args.command == "review":
        review_card(args.db, args.id, args.note)
        print(json.dumps({"id": args.id, "status": "reviewed"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
