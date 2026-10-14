import json
import pytest
from lockin_worker.db import MemoryDB


class FakeResp:
    def __init__(self, status=200, body=None):
        self.status_code = status
        self._body = body if body is not None else []
        self.text = json.dumps(self._body)

    def json(self):
        return self._body


class RecordingSession:
    def __init__(self, responses=None):
        self.calls = []
        self.responses = list(responses or [])

    def request(self, method, url, **kw):
        self.calls.append((method, url, kw))
        return self.responses.pop(0) if self.responses else FakeResp(200, [])


@pytest.fixture
def mdb():
    return MemoryDB()
