from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class PageSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page: int = Field(ge=1, le=1000)
    rotation: Literal[0, 90, 180, 270] = 0


class ConvertOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    pages: str = Field(default="", max_length=8000)
    page_plan: list[PageSpec] = Field(default_factory=list, max_length=1000)
    batch: bool = False
    postprocess: Literal["none", "compress", "watermark", "number"] = "none"
    split_every: int = Field(default=1, ge=1, le=200)
    crop_top: int = Field(default=5, ge=0, le=45)
    crop_right: int = Field(default=5, ge=0, le=45)
    crop_bottom: int = Field(default=5, ge=0, le=45)
    crop_left: int = Field(default=5, ge=0, le=45)
    watermark_opacity: float = Field(default=0.22, ge=0.05, le=1)
    watermark_angle: int = Field(default=30, ge=-180, le=180)
    flip: Literal["horizontal", "vertical"] = "horizontal"
    angle: Literal[90, 180, 270] = 90
    dpi: Literal[96, 144, 192] = 144
    password: str = Field(default="", max_length=128)
    new_password: str = Field(default="", max_length=128)
    text: str = Field(default="", max_length=120)
    start: int = Field(default=1, ge=1, le=100000)
    format: Literal["png", "jpg", "webp"] = "webp"
    quality: int = Field(default=85, ge=30, le=100)
    width: int = Field(default=1920, ge=16, le=8000)
    height: int = Field(default=1080, ge=16, le=8000)
    page_size: Literal["original", "a4"] = "original"
    language: Literal["eng", "rus", "eng+rus"] = "eng+rus"


class ConversionError(Exception):
    """A safe, user-facing conversion failure; never include file contents or secrets."""
