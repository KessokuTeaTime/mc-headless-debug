package dev.mchd.bridge;

final class BridgeRpcException extends RuntimeException {
	private final int code;

	BridgeRpcException(int code, String message) {
		super(message);
		this.code = code;
	}

	int code() {
		return this.code;
	}
}
