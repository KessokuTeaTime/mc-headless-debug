package dev.mchd.bridge;

import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStreamWriter;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.PosixFilePermission;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Base64;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

final class BridgeServer implements AutoCloseable {
	private static final Logger LOGGER = LoggerFactory.getLogger(MchdBridge.ID);
	private static final Gson GSON = new Gson();
	private static final int MAX_REQUEST_BYTES = 1024 * 1024;
	private static final long REQUEST_TIMEOUT_SECONDS = 120;

	private final ServerSocket socket;
	private final ExecutorService clients;
	private final Semaphore clientSlots = new Semaphore(32);
	private final Thread acceptThread;
	private final byte[] token;
	private final String adapterId;
	private final BridgeRuntime runtime;
	private final FileChannel lockChannel;
	private final FileLock sessionLock;
	private final Path tokenFile;
	private final Path portFile;

	private BridgeServer(
			ServerSocket socket,
			byte[] token,
			String adapterId,
			BridgeRuntime runtime,
			FileChannel lockChannel,
			FileLock sessionLock,
			Path tokenFile,
			Path portFile
	) {
		this.socket = socket;
		this.token = token;
		this.adapterId = adapterId;
		this.runtime = runtime;
		this.lockChannel = lockChannel;
		this.sessionLock = sessionLock;
		this.tokenFile = tokenFile;
		this.portFile = portFile;
		this.clients = Executors.newVirtualThreadPerTaskExecutor();
		this.acceptThread = Thread.ofPlatform()
				.name("mchd-bridge-accept")
				.daemon()
				.start(this::accept);
	}

	static BridgeServer start(
			Path gameDirectory,
			String adapterId,
			BridgeRuntime runtime
	) {
		try {
			String encodedTokenFile = System.getProperty("mchd.tokenFileBase64");
			Path tokenFile = encodedTokenFile == null
					? gameDirectory.resolve(".mchd").resolve("token")
					: Path.of(new String(
							Base64.getUrlDecoder().decode(encodedTokenFile),
							StandardCharsets.UTF_8
					));
			Path stateDirectory = tokenFile.toAbsolutePath().getParent();
			if (stateDirectory == null) {
				throw new IllegalStateException("Bridge token file has no parent directory");
			}
			Files.createDirectories(stateDirectory);

			Path lockFile = stateDirectory.resolve("session.lock");
			FileChannel lockChannel = FileChannel.open(
					lockFile,
					StandardOpenOption.CREATE,
					StandardOpenOption.WRITE,
					LinkOption.NOFOLLOW_LINKS
			);
			FileLock sessionLock;
			try {
				sessionLock = lockChannel.tryLock();
			} catch (OverlappingFileLockException exception) {
				sessionLock = null;
			}
			if (sessionLock == null) {
				lockChannel.close();
				throw new IllegalStateException(
						"Another MC Headless Debug session owns " + stateDirectory
				);
			}

			ServerSocket socket = null;
			int requestedPort = Integer.getInteger("mchd.port", 0);
			try {
				String host = System.getProperty("mchd.host", "127.0.0.1");
				InetAddress address = InetAddress.getByName(host);
				if (!address.isLoopbackAddress()) {
					throw new IllegalStateException("Bridge host is not loopback: " + host);
				}
				socket = new ServerSocket(
						requestedPort,
						16,
						address
				);
				byte[] token = new byte[32];
				new SecureRandom().nextBytes(token);
				writeNoFollow(tokenFile, HexFormat.of().formatHex(token));
				restrictTokenFile(tokenFile);
				Path portFile = stateDirectory.resolve("port");
				writeNoFollow(
						portFile,
						Integer.toString(socket.getLocalPort())
				);
				return new BridgeServer(
						socket,
						token,
						adapterId,
						runtime,
						lockChannel,
						sessionLock,
						tokenFile,
						portFile
				);
			} catch (IOException | RuntimeException exception) {
				if (socket != null) {
					socket.close();
				}
				sessionLock.release();
				lockChannel.close();
				throw exception;
			}
		} catch (IOException exception) {
			throw new IllegalStateException("Could not start MC Headless Debug bridge", exception);
		}
	}

	private static void writeNoFollow(Path path, String content) throws IOException {
		if (Files.isSymbolicLink(path)) {
			throw new IOException("Refusing to write symbolic link: " + path);
		}
		try (FileChannel channel = FileChannel.open(
				path,
				StandardOpenOption.CREATE,
				StandardOpenOption.TRUNCATE_EXISTING,
				StandardOpenOption.WRITE,
				LinkOption.NOFOLLOW_LINKS
		)) {
			channel.write(ByteBuffer.wrap(content.getBytes(StandardCharsets.UTF_8)));
			channel.force(true);
		}
	}

	int port() {
		return this.socket.getLocalPort();
	}

	private void accept() {
		while (!this.socket.isClosed()) {
			try {
				Socket client = this.socket.accept();
				if (this.clientSlots.tryAcquire()) {
					this.clients.submit(() -> {
						try {
							this.handle(client);
						} finally {
							this.clientSlots.release();
						}
					});
				} else {
					client.close();
					LOGGER.warn("Rejected bridge connection: concurrency limit reached");
				}
			} catch (IOException exception) {
				if (!this.socket.isClosed()) {
					LOGGER.error("MC Headless Debug bridge accept failed", exception);
				}
			}
		}
	}

	private void handle(Socket client) {
		try (client;
				 BufferedWriter writer = new BufferedWriter(new OutputStreamWriter(
						 client.getOutputStream(),
						 StandardCharsets.UTF_8
				 ))) {
			String id = "unknown";
			CompletableFuture<JsonElement> response = null;
			try {
				client.setSoTimeout((int) TimeUnit.SECONDS.toMillis(5));
				String line = readLimitedLine(client.getInputStream());
				JsonObject request = JsonParser.parseString(line).getAsJsonObject();
				id = requiredString(request, "id");
				if (!this.authenticated(requiredString(request, "token"))) {
					writeError(writer, id, -32001, "Authentication failed");
					return;
				}

				client.setSoTimeout((int) TimeUnit.SECONDS.toMillis(REQUEST_TIMEOUT_SECONDS));
				String method = requiredString(request, "method");
				JsonObject params = request.has("params")
						? request.getAsJsonObject("params")
						: new JsonObject();
				response = this.runtime.dispatch(
						this.adapterId,
						method,
						params
				);
				writeResult(
						writer,
						id,
						response.get(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS)
				);
				if ("runtime.stop".equals(method)) {
					this.runtime.confirmStopResponse();
				}
			} catch (BridgeRpcException exception) {
				writeError(writer, id, exception.code(), exception.getMessage());
			} catch (ExecutionException exception) {
				Throwable cause = exception.getCause();
				if (cause instanceof BridgeRpcException rpcException) {
					writeError(writer, id, rpcException.code(), rpcException.getMessage());
				} else {
					LOGGER.error("Bridge dispatch failed", cause);
					writeError(writer, id, -32603, message(cause));
				}
			} catch (TimeoutException exception) {
				if (response != null) {
					response.cancel(true);
				}
				writeError(writer, id, -32003, "Bridge operation timed out");
			} catch (RuntimeException exception) {
				LOGGER.error("Bridge request failed", exception);
				writeError(writer, id, -32603, message(exception));
			}
		} catch (IOException exception) {
			LOGGER.warn("Bridge connection failed", exception);
		} catch (InterruptedException exception) {
			Thread.currentThread().interrupt();
		}
	}

	private boolean authenticated(String candidate) {
		byte[] decoded;
		try {
			decoded = HexFormat.of().parseHex(candidate);
		} catch (IllegalArgumentException exception) {
			return false;
		}
		return MessageDigest.isEqual(this.token, decoded);
	}

	private static String readLimitedLine(InputStream input) throws IOException {
		byte[] bytes = new byte[MAX_REQUEST_BYTES];
		int length = 0;
		while (length < bytes.length) {
			int value = input.read();
			if (value < 0 || value == '\n') {
				return new String(bytes, 0, length, StandardCharsets.UTF_8);
			}
			bytes[length++] = (byte) value;
		}
		throw new BridgeRpcException(-32002, "Request exceeds 1 MiB");
	}

	private static String requiredString(JsonObject object, String key) {
		if (!object.has(key) || !object.get(key).isJsonPrimitive()) {
			throw new BridgeRpcException(-32600, "Missing string property: " + key);
		}
		return object.get(key).getAsString();
	}

	private static void writeResult(
			BufferedWriter writer,
			String id,
			JsonElement result
	) throws IOException {
		JsonObject response = new JsonObject();
		response.addProperty("jsonrpc", "2.0");
		response.addProperty("id", id);
		response.add("result", result);
		writer.write(GSON.toJson(response));
		writer.newLine();
		writer.flush();
	}

	private static void writeError(
			BufferedWriter writer,
			String id,
			int code,
			String message
	) throws IOException {
		JsonObject error = new JsonObject();
		error.addProperty("code", code);
		error.addProperty("message", message);
		JsonObject response = new JsonObject();
		response.addProperty("jsonrpc", "2.0");
		response.addProperty("id", id);
		response.add("error", error);
		writer.write(GSON.toJson(response));
		writer.newLine();
		writer.flush();
	}

	private static String message(Throwable throwable) {
		return throwable == null || throwable.getMessage() == null
				? "Internal error"
				: throwable.getMessage();
	}

	private static void restrictTokenFile(Path tokenFile) {
		try {
			Files.setPosixFilePermissions(tokenFile, Set.of(
					PosixFilePermission.OWNER_READ,
					PosixFilePermission.OWNER_WRITE
			));
		} catch (UnsupportedOperationException | IOException exception) {
			LOGGER.warn("Could not restrict bridge token permissions: {}", tokenFile);
		}
	}

	@Override
	public void close() {
		try {
			this.socket.close();
		} catch (IOException exception) {
			LOGGER.warn("Could not close MC Headless Debug bridge socket", exception);
		}
		this.clients.shutdownNow();
		try {
			Files.deleteIfExists(this.tokenFile);
			Files.deleteIfExists(this.portFile);
			this.sessionLock.release();
			this.lockChannel.close();
		} catch (IOException exception) {
			LOGGER.warn("Could not release bridge session lock", exception);
		}
	}
}
