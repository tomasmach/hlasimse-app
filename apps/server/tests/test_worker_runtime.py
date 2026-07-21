import signal

from core.worker_runtime import GracefulStop, graceful_stop_signals


def test_graceful_stop_interrupts_wait_immediately():
    stop = GracefulStop()

    stop.request()

    assert stop.requested is True
    assert stop.wait(60) is True


def test_graceful_stop_context_restores_signal_handlers():
    before = {signum: signal.getsignal(signum) for signum in (signal.SIGTERM, signal.SIGINT)}

    with graceful_stop_signals() as stop:
        assert stop.requested is False
        stop.request(signal.SIGTERM)
        assert stop.requested is True

    assert {
        signum: signal.getsignal(signum) for signum in (signal.SIGTERM, signal.SIGINT)
    } == before
