import http from "node:http";

const port = Number(process.env.XINYIN_MOCK_PORT || 11434);
const headers = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "content-type": "application/json; charset=utf-8",
};

const server = http.createServer((request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, headers);
    response.end();
    return;
  }
  if (request.method === "GET" && request.url === "/v1/models") {
    response.writeHead(200, headers);
    response.end(JSON.stringify({ data: [{ id: "mobile-layout-mock" }] }));
    return;
  }
  if (request.method === "POST" && request.url === "/v1/chat/completions") {
    request.resume();
    request.on("end", () => {
      response.writeHead(200, headers);
      response.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: "移动端布局测试回复。" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 8, completion_tokens: 8, total_tokens: 16 },
      }));
    });
    return;
  }
  response.writeHead(404, headers);
  response.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`mobile mock listening on ${port}\n`);
});
