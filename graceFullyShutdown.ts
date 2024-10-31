import express, { Application, NextFunction, Request, Response } from "express";
import { Server } from "http";
import Redis from "ioredis";

const redis = new Redis("add your connection string");

const GRACEFULL = {
  shuttingDown: false,
  ongoingRequests: 0,
  server: Server,
};

const SERVICE_UNAVAILABLE = 503;
const OK = 200;

interface AppWithServer extends Application {
  server?: Server;
}

const app: AppWithServer = express();

app.use((req: Request, res: Response, next: NextFunction) => {
  res.set("Connection", "close");
  res.setHeader("Connection", "close");
  GRACEFULL.ongoingRequests++;
  if (process.env.ENV == "local") {
    console.log(
      `Request started, ongoingRequests: ${GRACEFULL.ongoingRequests}`,
    );
  }
  let onFinishedCalled = false;
  const decrementOngoingRequests = () => {
    if (onFinishedCalled) return;
    GRACEFULL.ongoingRequests--;
    onFinishedCalled = true;
    if (process.env.ENV == "local") {
      console.log(
        `Request finished, ongoingRequests: ${GRACEFULL.ongoingRequests}`,
      );
    }
    if (GRACEFULL.shuttingDown && GRACEFULL.ongoingRequests === 0) {
      if (app.server) closeServer(app.server);
    }
  };
  res.on("finish", decrementOngoingRequests);
  res.on("close", decrementOngoingRequests);
  next();
});

app.get("/ready", async (req: Request, res: Response) => {
  try {
    if (GRACEFULL.shuttingDown) {
      return res
        .status(SERVICE_UNAVAILABLE)
        .send("Server is shutting down, try again later.");
    }
    const connected = await redis.ping();
    if (connected == "PONG") return res.status(OK).send("OK");
    return res.status(SERVICE_UNAVAILABLE).send("Service Unavailable");
  } catch (error) {
    return res.status(SERVICE_UNAVAILABLE).send("Service Unavailable");
  }
});

app.get("/live", async (req: Request, res: Response) => {
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

app.get("/health", async (req: Request, res: Response) => {
  if (GRACEFULL.shuttingDown) {
    return res
      .status(SERVICE_UNAVAILABLE)
      .send("Server is shutting down, try again later.");
  }
  res.sendStatus(200);
});

const port = process.env.PORT || 5000;
const server = app.listen(port, () =>
  console.log(
    `express.ts app listening at http://localhost:${port} mode ${process.env.ENV}!!!`,
  ),
);

const closeServer = async (server: Server) => {
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
process.on("SIGINT", gracefulShutdown); // สำหรับการหยุด process ด้วย Ctrl+
