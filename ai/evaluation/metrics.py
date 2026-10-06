"""Dependency-free classification and localization metrics."""
import math


def ratio(numerator: int | float, denominator: int | float) -> float | None:
    return numerator / denominator if denominator else None


def binary_scores(tp: int, fp: int, fn: int, tn: int) -> dict:
    """Scores on assessed binary decisions; undefined rates remain null."""
    recall = ratio(tp, tp + fn)
    specificity = ratio(tn, tn + fp)
    return {
        **prf(tp, fp, fn), "tn": tn,
        "accuracy": ratio(tp + tn, tp + fp + fn + tn),
        "specificity": specificity,
        "fpr": ratio(fp, fp + tn),
        "balanced_accuracy": (recall + specificity) / 2
        if recall is not None and specificity is not None else None,
    }

def precision_recall_f1(predicted: set[str], expected: set[str]) -> tuple[float, float, float]:
    tp = len(predicted & expected)
    precision = tp / len(predicted) if predicted else float(not expected)
    recall = tp / len(expected) if expected else float(not predicted)
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return precision, recall, f1

def prf(tp: int, fp: int, fn: int) -> dict[str, float | int]:
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"tp": tp, "fp": fp, "fn": fn, "precision": precision, "recall": recall, "f1": f1}

def bbox_iou(left, right) -> float:
    if not valid_bbox(left) or not valid_bbox(right):
        return 0.0
    lx, ly, lw, lh = map(float, left); rx, ry, rw, rh = map(float, right)
    x1, y1, x2, y2 = max(lx, rx), max(ly, ry), min(lx + lw, rx + rw), min(ly + lh, ry + rh)
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    union = lw * lh + rw * rh - intersection
    return intersection / union if union > 0 else 0.0


def valid_bbox(box) -> bool:
    return (
        isinstance(box, (list, tuple)) and len(box) == 4
        and all(isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x) for x in box)
        and box[2] > 0 and box[3] > 0
    )
