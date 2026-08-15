import unittest

from crop import bbox_area, choose_anchor, crop_9_16, crop_contain_9_16, crop_score, pick_standing_person, pose_center


class CropTests(unittest.TestCase):
    def test_landscape_window_is_9_16(self):
        box = crop_9_16(1920, 1080, 960, 540)
        x, y, w, h = box
        self.assertEqual(y, 0)
        self.assertEqual(h, 1080)
        self.assertAlmostEqual(w / h, 9 / 16, places=2)
        self.assertGreaterEqual(x, 0)
        self.assertLessEqual(x + w, 1920)

    def test_person_anchor_uses_chest_not_bbox_center(self):
        people = [{"bbox": [640, 120, 420, 900], "confidence": 0.9}]
        cx, cy, name = choose_anchor("person", people, [], [], [], 1920, 1080)
        self.assertEqual(name, "person_bbox")
        self.assertAlmostEqual(cx, 640 + 210, places=0)
        self.assertAlmostEqual(cy, 120 + 900 * 0.35, places=0)

    def test_pose_center_normalizes(self):
        kps = [
            {"name": "nose", "x": 0.5, "y": 0.2, "confidence": 0.9},
            {"name": "left_shoulder", "x": 0.4, "y": 0.35, "confidence": 0.8},
            {"name": "right_shoulder", "x": 0.6, "y": 0.35, "confidence": 0.8},
            {"name": "left_hip", "x": 0.45, "y": 0.6, "confidence": 0.7},
            {"name": "right_hip", "x": 0.55, "y": 0.6, "confidence": 0.7},
        ]
        cx, cy = pose_center(kps, 1920, 1080)
        self.assertIsNotNone(cx)
        self.assertGreater(cy, 0.2)
        self.assertLess(cy, 0.5)

    def test_plate_mode_ignores_person(self):
        people = [{"bbox": [0, 0, 800, 1000], "confidence": 0.9}]
        plates = [{"bbox": [200, 700, 280, 180], "class_name": "bowl"}]
        cx, cy, name = choose_anchor("plate", people, [], plates, [], 1920, 1080)
        self.assertEqual(name, "plate")
        self.assertAlmostEqual(cx, 340, places=0)

    def test_empty_frame_falls_back_to_center(self):
        cx, cy, name = choose_anchor("auto", [], [], [], [], 1920, 1080)
        self.assertEqual(name, "frame_center")
        self.assertEqual((cx, cy), (960, 540))
        self.assertLess(crop_score(name, False, False, False, "auto"), 0.3)

    def test_bbox_area(self):
        self.assertEqual(bbox_area([0, 0, 10, 20]), 200)

    def test_contain_keeps_left_person_inside_window(self):
        box, mode, _tight = crop_contain_9_16(1280, 720, [380, 140, 280, 520])
        x, y, w, h = box
        self.assertEqual(mode, "crop")
        self.assertEqual(y, 0)
        self.assertEqual(h, 720)
        self.assertLessEqual(x, 380)
        self.assertGreaterEqual(x + w, 380 + 280)

    def test_contain_pad_blur_when_body_wider_than_9_16(self):
        _box, mode, tight = crop_contain_9_16(1280, 720, [80, 40, 720, 640])
        self.assertEqual(mode, "pad_blur")
        self.assertTrue(tight)

    def test_contain_bbox_stays_inside_frame(self):
        box, mode, _tight = crop_contain_9_16(1280, 720, [900, 10, 370, 700])
        x, y, w, h = box
        self.assertEqual(mode, "pad_blur")
        self.assertGreaterEqual(x, 0)
        self.assertGreaterEqual(y, 0)
        self.assertLessEqual(x + w, 1280)
        self.assertLessEqual(y + h, 720)
        self.assertEqual(x % 2, 0)
        self.assertEqual(y % 2, 0)
        self.assertEqual(w % 2, 0)
        self.assertEqual(h % 2, 0)

    def test_standing_person_beats_seated_blob(self):
        picked = pick_standing_person(
            [
                {"bbox": [500, 400, 360, 220], "is_full_body": False},
                {"bbox": [380, 140, 220, 520], "is_full_body": True},
            ]
        )
        self.assertEqual(picked["bbox"], [380, 140, 220, 520])


if __name__ == "__main__":
    unittest.main()
