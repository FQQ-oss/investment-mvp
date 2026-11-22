import tempfile
import unittest
from pathlib import Path

from mvp import connect, make_card, review_card, save_card


class InvestmentMvpTests(unittest.TestCase):
    def test_create_card_has_counter_arguments_and_review_condition(self):
        card = make_card("abc", "buy", "订单增长", "medium", 10, 7)
        self.assertEqual(card["symbol"], "ABC")
        self.assertTrue(card["counter_arguments"])
        self.assertTrue(any("订单" in item for item in card["invalidation_conditions"]))

    def test_card_can_be_saved_and_reviewed(self):
        with tempfile.TemporaryDirectory() as directory:
            db_path = Path(directory) / "test.db"
            card = make_card("ABC", "watch", "估值", "short", None, 1)
            save_card(db_path, card)
            review_card(db_path, card["id"], "估值仍需验证")
            with connect(db_path) as connection:
                row = connection.execute("SELECT status, review_note FROM decision_cards").fetchone()
            self.assertEqual(row["status"], "reviewed")
            self.assertEqual(row["review_note"], "估值仍需验证")

    def test_invalid_max_loss_is_rejected(self):
        with self.assertRaises(ValueError):
            make_card("ABC", "buy", "业绩改善", "medium", 0, 7)


if __name__ == "__main__":
    unittest.main()
