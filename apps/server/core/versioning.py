import re
from dataclasses import dataclass

SEMVER_PATTERN = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)"
    r"(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)


class InvalidSemVer(ValueError):
    pass


@dataclass(frozen=True)
class SemVer:
    major: int
    minor: int
    patch: int
    prerelease: tuple[str, ...]

    def __lt__(self, other: object) -> bool:
        if not isinstance(other, SemVer):
            return NotImplemented
        own_core = (self.major, self.minor, self.patch)
        other_core = (other.major, other.minor, other.patch)
        if own_core != other_core:
            return own_core < other_core
        if not self.prerelease:
            return False
        if not other.prerelease:
            return True
        for own, candidate in zip(self.prerelease, other.prerelease, strict=False):
            if own == candidate:
                continue
            own_numeric = own.isdigit()
            candidate_numeric = candidate.isdigit()
            if own_numeric and candidate_numeric:
                return int(own) < int(candidate)
            if own_numeric != candidate_numeric:
                return own_numeric
            return own < candidate
        return len(self.prerelease) < len(other.prerelease)


def parse_semver(value: str) -> SemVer:
    match = SEMVER_PATTERN.fullmatch(value)
    if not match:
        raise InvalidSemVer("version must be a valid semantic version")
    prerelease = tuple(match.group(4).split(".")) if match.group(4) else ()
    return SemVer(
        major=int(match.group(1)),
        minor=int(match.group(2)),
        patch=int(match.group(3)),
        prerelease=prerelease,
    )
