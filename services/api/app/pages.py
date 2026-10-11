from __future__ import annotations
import re
from .models import ConversionError


def parse_pages(value: str, count: int, *, allow_empty: bool = True) -> list[int]:
    """Parse one-based ranges without sorting; e.g. '3,1-2' -> [2,0,1]."""
    if count < 1:
        raise ConversionError("В документе нет страниц.")
    if not value.strip():
        if allow_empty:
            return list(range(count))
        raise ConversionError("Укажите номера страниц, например: 1–3, 5.")
    normalized = value.replace("–", "-").replace("—", "-")
    result: list[int] = []
    seen: set[int] = set()
    for part in normalized.split(","):
        match = re.fullmatch(r"\s*(\d+)(?:\s*-\s*(\d+))?\s*", part)
        if not match:
            raise ConversionError("Неверный диапазон. Используйте запись: 1–3, 5, 7.")
        first, last = int(match[1]), int(match[2] or match[1])
        if first < 1 or last < first or last > count:
            raise ConversionError(f"Диапазон выходит за пределы документа: в нём {count} стр.")
        for number in range(first - 1, last):
            if number in seen:
                raise ConversionError("Номера страниц не должны повторяться.")
            result.append(number)
            seen.add(number)
    return result
