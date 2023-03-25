import { Chess } from 'chess.js';
import chardet from 'chardet';
import request from 'request';
import zlib from 'zlib';
import { userAgent } from '../config';
import { TextDecoder } from 'util';

// Add missing type for chess.js
declare module 'chess.js' {
  export interface ChessInstance {
    set_comment(comment: string): void;
  }
}

const chessDotComHeaders = {
  'User-Agent': userAgent,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  Origin: 'https://www.chess.com',
  DNT: '1',
  Connection: 'keep-alive',
  Referer: 'https://www.chess.com/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'cross-site',
  'Content-Length': '0',
};
// NOTE: these types don't contain all the fields, just the ones we care about.
interface Round {
  id: number;
  slug: string;
}
interface Room {
  id: number;
  timeControl: string;
}
interface Player {
  name: string;
  title: string;
}
interface Game {
  roundId: number;
  slug: string;
  blackElo: number;
  whiteElo: number;
  white: Player;
  black: Player;
  result: string;
}

interface Move {
  ply: number;
  cbn: string;
  clock: number;
}
// https://nxt.chessbomb.com/events/api/room/<event_id>
interface RoomInfo {
  room: Room;
  name: string;
  rounds: Round[];
  games: Game[];
}
// https://nxt.chessbomb.com/events/api/game/<event_id>/<round_slug>/<round_slug>/<game_slug>
interface GameInfo {
  game: Game;
  room: Room;
  moves: Move[];
}
async function GetGamePgn(
  eventId: string,
  room: RoomInfo,
  roundSlug: string,
  gameSlug: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    // XXX: We are trying to disguise ourselves as a browser here.
    request(
      {
        uri: `https://nxt.chessbomb.com/events/api/game/${eventId}/${roundSlug}/${gameSlug}`,
        method: 'POST',
        headers: chessDotComHeaders,
        gzip: true,
      },
      (err, res, body: Buffer) => {
        const gameInfo = JSON.parse(body.toString()) as GameInfo;
        const game = new Chess();
        for (const move of gameInfo.moves) {
          // Chessdotcom mentions both long algebraic notation and algebraic notation.separated by a underscore '_'
          // We only need either one of it
          const [_, san] = move.cbn.split('_');
          game.move(san);
          const hours = Math.floor(move.clock / (3600 * 1000));
          const minutes = Math.floor((move.clock / (60 * 1000)) % 60);
          const seconds = Math.floor((move.clock / 1000) % 60);
          game.set_comment(`[%clk ${hours}:${minutes}:${seconds}]`);
        }
        game.header('Event', room.name);
        game.header('White', gameInfo.game.white.name);
        game.header('Black', gameInfo.game.black.name);
        game.header('WhiteElo', gameInfo.game.whiteElo.toString());
        game.header('BlackElo', gameInfo.game.blackElo.toString());
        game.header('TimeControl', room.room.timeControl);
        game.header('Round', roundSlug);
        game.header('Result', gameInfo.game.result);

        resolve(game.pgn());
      }
    );
  });
}
export default async function FetchChessDotCom(
  name: string,
  url: string
): Promise<string> {
  let pgn = '';
  // The URL is of form chessdotcom:<event_id>/<round_slug>
  const [eventId, roundSlug] = url.substring('chessdotcom:'.length).split('/');
  return new Promise((resolve, reject) => {
    // XXX: We are trying to disguise ourselves as a browser here.
    // TODO: It would make sense to cache this since this data is very unlikely to change.
    request(
      {
        uri: `https://nxt.chessbomb.com/events/api/room/${eventId}`,
        method: 'POST',
        headers: chessDotComHeaders,
        gzip: true,
      },
      async (err, res, body: Buffer) => {
        const eventInfo = JSON.parse(body.toString()) as RoomInfo;
        const round = eventInfo.rounds.find((r: Round) => r.slug === roundSlug);
        if (typeof round === 'undefined') {
          reject(`Round ${roundSlug} not found in event ${eventId}`);
          return;
        }
        for (const game of eventInfo.games) {
          if (game.roundId === round.id) {
            const gamePgn = await GetGamePgn(
              eventId,
              eventInfo,
              roundSlug,
              game.slug
            );
            pgn += gamePgn;
            pgn += '\n\n';
          }
        }
        resolve(pgn);
      }
    );
  });
}
