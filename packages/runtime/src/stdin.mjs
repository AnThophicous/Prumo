export function readBoundedStdin({ stream = process.stdin, timeoutMs = 800, limitBytes = 1_000_000 } = {}) {
  return new Promise(resolve => {
    if (stream.isTTY) {
      resolve("");
      return;
    }
    const chunks = [];
    let received = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      stream.pause();
      stream.off("data", onData);
      stream.off("end", finish);
      stream.off("error", finish);
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const timer = setTimeout(finish, timeoutMs);
    const onData = chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = limitBytes + 1 - received;
      if (remaining <= 0) return finish();
      chunks.push(buffer.subarray(0, remaining));
      received += buffer.length;
      if (received > limitBytes) finish();
    };
    stream.on("data", onData);
    stream.on("end", finish);
    stream.on("error", finish);
  });
}
