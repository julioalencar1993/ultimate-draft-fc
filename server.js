const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server);

app.use(express.static("."));

const rooms = {};

function generateCode() {
  return Math.floor(
    10000000 + Math.random() * 90000000
  ).toString();
}

io.on("connection", (socket) => {

  console.log("Jogador conectado");

  socket.on("createRoom", ({ password, club }) => {

    const code = generateCode();

    rooms[code] = {
      password,
      players: [{
        id: socket.id,
        club
      }]
    };

    socket.join(code);

    socket.emit("roomCreated", {
      code
    });

  });

  socket.on("joinRoom", ({ code, password, club }) => {

    const room = rooms[code];

    if (!room) {
      socket.emit(
        "errorJoin",
        "Sala não encontrada"
      );
      return;
    }

    if (room.password !== password) {
      socket.emit(
        "errorJoin",
        "Senha incorreta"
      );
      return;
    }

    room.players.push({
      id: socket.id,
      club
    });

    socket.join(code);

    io.to(code).emit(
      "playerList",
      room.players
    );

  });

});

server.listen(
  process.env.PORT || 3000,
  () => console.log("Servidor iniciado")
);
