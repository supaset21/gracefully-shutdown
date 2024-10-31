const express = require("express");
const { Server } = require("http");
const Redis = require("ioredis");

const redis = new Redis("add your connection string");

const sleep = async (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const GRACEFULL = {
  shuttingDown: false,
  ongoingRequests: 0,
  server: Server,
};

const SERVICE_UNAVAILABLE = 503;
const OK = 200;

const app = express();

app.use((req, res, next) => {
  res.set("Connection", "close");
  res.setHeader("Connection", "close");
  GRACEFULL.ongoingRequests++;
  console.log(`Request started, ongoingRequests: ${GRACEFULL.ongoingRequests}`);

  let onFinishedCalled = false;
  const decrementOngoingRequests = () => {
    if (onFinishedCalled) return;
    GRACEFULL.ongoingRequests--;
    onFinishedCalled = true;
    console.log(
      `Request finished, ongoingRequests: ${GRACEFULL.ongoingRequests}`,
    );

    if (GRACEFULL.shuttingDown && GRACEFULL.ongoingRequests === 0) {
      if (app.server) closeServer(app.server);
    }
  };
  res.on("finish", decrementOngoingRequests);
  res.on("close", decrementOngoingRequests);
  next();
});

app.get("/ready", async (req, res) => {
  try {
    if (GRACEFULL.shuttingDown) {
      return res
        .status(SERVICE_UNAVAILABLE)
        .send("Server is shutting down, try again later.");
    }
    // todo your db connection
    const connected = await redis.ping();
    if (connected === "PONG") return res.status(OK).send("OK");
    return res.status(SERVICE_UNAVAILABLE).send("Service Unavailable");
  } catch (error) {
    return res.status(SERVICE_UNAVAILABLE).send("Service Unavailable");
  }
});

app.get("/live", async (req, res) => {
  try {
    if (GRACEFULL.shuttingDown) {
      return res
        .status(SERVICE_UNAVAILABLE)
        .send("Server is shutting down, try again later.");
    }
    await redis.set("pod:live", 1, "EX", 60);
    return res.status(OK).send("Alive");
  } catch (error) {
    return res.status(SERVICE_UNAVAILABLE).send("Service Unavailable");
  }
});

app.get("/health", (req, res) => {
  /* Load Balance */
  if (GRACEFULL.shuttingDown) {
    return res
      .status(SERVICE_UNAVAILABLE)
      .send("Server is shutting down, try again later.");
  }
  return res.sendStatus(OK);
});

app.get("/load", async (req, res) => {
  await sleep(1000);
  return res.sendStatus(OK);
});

const port = process.env.PORT || 5000;
const server = app.listen(port, () => {
  console.log(`App listening at http://localhost:${port}`);
});

const closeServer = (server) => {
  server.close(() => {
    console.log("Closed out remaining connections.");
    process.exit(0);
  });
  setTimeout(() => {
    console.error(
      "Could not close connections in time, forcefully shutting down.",
    );
    process.exit(1);
  }, 3 * 60 * 1000);
};

const gracefulShutdown = () => {
  GRACEFULL.shuttingDown = true;
  console.log("Received kill signal, shutting down gracefully.");
  if (GRACEFULL.ongoingRequests === 0) closeServer(server);
};

process.on("SIGTERM", gracefulShutdown); // สำหรับ Kubernetes หรือ container orchestration
process.on("SIGINT", gracefulShutdown); // สำหรับการหยุด process ด้วย Ctrl+C
