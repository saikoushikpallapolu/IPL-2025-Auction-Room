from contextlib import asynccontextmanager
from threading import Lock
from time import monotonic
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, StrictInt

from .simulator_engine import Auction, Catalog, RETENTION_SLABS, TEAMS
from .train_predictor import ROOT


class Setup(BaseModel):
    team: str
    keep: list[str]


class Move(BaseModel):
    action: str
    version: int
    lot: int | None = None
    price: int | None = None
    amount: int | None = None
    nominations: list[str] = Field(default_factory=list, max_length=10)


class Lineup(BaseModel):
    order: list[StrictInt] = Field(max_length=11)
    keeper: StrictInt | None = None
    draft: bool = False


@asynccontextmanager
async def lifespan(app):
    app.state.catalog = Catalog.load()
    yield


app = FastAPI(lifespan=lifespan)
sessions = {}
lock = Lock()
COOKIE = "ipl_auction"
SESSION_TTL = 12 * 3600


def current_auction(request):
    token = request.cookies.get(COOKIE)
    entry = sessions.get(token)
    if entry is None:
        raise HTTPException(404, "Start an auction first.")
    _, auction = entry
    sessions[token] = (monotonic(), auction)
    return auction


@app.get("/api/config")
def config(request: Request):
    with lock:
        catalog = request.app.state.catalog
        return {
            "teams": {code: profile[0] for code, profile in TEAMS.items()},
            "retained": catalog.retained,
            "players": len(catalog.players),
            "modeled": sum(p["valuation"] is not None for p in catalog.players),
            "estimated": sum(p["sale_probability"] is not None for p in catalog.players),
            "retention_slabs": RETENTION_SLABS,
        }


@app.post("/api/start")
def start(setup: Setup, request: Request, response: Response):
    try:
        auction = Auction(request.app.state.catalog, setup.team, setup.keep)
    except ValueError as error:
        raise HTTPException(400, str(error)) from error
    with lock:
        now = monotonic()
        for token, (seen, _) in list(sessions.items()):
            if now - seen > SESSION_TTL:
                del sessions[token]
        sessions.pop(request.cookies.get(COOKIE), None)
        token = uuid4().hex
        sessions[token] = (now, auction)
        response.set_cookie(COOKIE, token, httponly=True, samesite="strict")
        return auction.snapshot()


@app.get("/api/state")
def state(request: Request, after: int | None = None):
    with lock:
        auction = current_auction(request)
        auction.tick()
        if after == auction.version:
            return Response(status_code=204)
        return auction.snapshot()


@app.post("/api/action")
def action(move: Move, request: Request):
    with lock:
        auction = current_auction(request)
        if move.action in {"pause", "resume"}:
            auction.act(move.action)
            return auction.snapshot()
        same_lot = move.lot == auction.index + 1
        current_offer = (
            move.action == "bid" and same_lot and auction.phase == "bidding"
            and move.price == auction.ask_price()
        )
        if not current_offer:
            auction.tick()
        if move.version != auction.version and not (current_offer or move.action == "skip" and same_lot):
            return auction.snapshot()
        try:
            auction.act(move.action, amount=move.amount, nominations=move.nominations)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return auction.snapshot()


@app.post("/api/lineup")
def save_lineup(lineup: Lineup, request: Request):
    with lock:
        auction = current_auction(request)
        try:
            auction.save_lineup(lineup.order, lineup.keeper, draft=lineup.draft)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        return auction.snapshot()


app.mount("/", StaticFiles(directory=ROOT / "web", html=True))
