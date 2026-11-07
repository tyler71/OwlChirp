import unittest.mock

from app.server.lib.Helper import get_sha384_hash


def test_get_sha384_hash():
    successful_result = "edd2ab3262b6c0121d706087045b60d51d6dc2f7419987ba12c983053a70c1057f15f58608ee07e1225266df36ba2c9c"

    test_data = "teststring".encode()
    mock_file = unittest.mock.mock_open(read_data=test_data)
    with unittest.mock.patch('builtins.open', mock_file):
        assert get_sha384_hash('abc') == successful_result
