"""A sparkline, drawn as a table of coordinates.

No chart library, no JavaScript: an SVG polyline is enough to show a doctor that
a line is going up, and it survives greyscale, printing and a screenshot in a
slide.
"""

from __future__ import annotations

from datetime import date

HEIGHT = 48
WIDTH = 260
PADDING = 4


def sparkline(points: list[tuple[date, int]], maximum: int) -> str:
    """Return the `points` attribute for an SVG polyline, or "" if too few."""
    if len(points) < 2 or maximum <= 0:
        return ""
    first, last = points[0][0], points[-1][0]
    span = max((last - first).days, 1)
    usable = WIDTH - 2 * PADDING
    heights = HEIGHT - 2 * PADDING
    coordinates = [
        f"{PADDING + (day - first).days / span * usable:.1f},"
        f"{HEIGHT - PADDING - min(value, maximum) / maximum * heights:.1f}"
        for day, value in points
    ]
    return " ".join(coordinates)
