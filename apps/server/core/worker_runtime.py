import signal
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from types import FrameType


class GracefulStop:
    """Cooperative SIGTERM/SIGINT stop flag for long-running management commands."""

    def __init__(self) -> None:
        self._event = threading.Event()

    @property
    def requested(self) -> bool:
        return self._event.is_set()

    def request(self, _signum: int | None = None, _frame: FrameType | None = None) -> None:
        self._event.set()

    def wait(self, seconds: float) -> bool:
        return self._event.wait(max(seconds, 0.0))


@contextmanager
def graceful_stop_signals() -> Iterator[GracefulStop]:
    stop = GracefulStop()
    previous_handlers: dict[signal.Signals, signal.Handlers] = {}
    if threading.current_thread() is threading.main_thread():
        for signum in (signal.SIGTERM, signal.SIGINT):
            previous_handlers[signum] = signal.getsignal(signum)
            signal.signal(signum, stop.request)
    try:
        yield stop
    finally:
        for signum, handler in previous_handlers.items():
            signal.signal(signum, handler)
