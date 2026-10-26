import os
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

API_KEY = os.environ.get("GEMMA_API_KEY", "")
MODEL = os.getenv("GEMMA_MODEL", "gemma-3-27b-it")  # AI Studio mein jo Gemma model dikhe wahi daalo
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("FRONTEND_URL", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

RULES = (
    "You are LabAssistant, a lab tutor for students. Use ONLY the context given. "
    "Do not invent numbers or do calculations; use the numbers provided. "
    "If the context is not enough, say so. Use simple language, max 4 short sentences."
)
HINT_LEVELS = {
    0: "Ask ONE guiding question. Do not reveal the answer.",
    1: "Tell which stage or setting to re-check. Do not reveal the cause.",
    2: "Name the type of problem, but not the exact fix.",
    3: "Reveal the cause and the fix, and explain why.",
}


class Req(BaseModel):
    mode: str = "explain"  # "explain" | "hint"
    context: str
    question: str = ""
    level: int = 0
    lang: str = "English"


@app.get("/health")
def health():
    return {"ok": True, "key_set": bool(API_KEY), "model": MODEL}


@app.post("/gemma")
async def gemma(r: Req):
    if not API_KEY:
        raise HTTPException(500, "GEMMA_API_KEY not set")
    task = (
        HINT_LEVELS.get(r.level, HINT_LEVELS[0])
        if r.mode == "hint"
        else "Explain the context in simple words for a student."
    )
    prompt = (
        f"{RULES}\nReply in {r.lang}.\nTask: {task}\n\n"
        f"CONTEXT:\n{r.context}\n\nSTUDENT QUESTION:\n{r.question or '(none)'}"
    )
    body = {"contents": [{"role": "user", "parts": [{"text": prompt}]}]}
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            res = await c.post(URL, json=body, headers={"x-goog-api-key": API_KEY})
            res.raise_for_status()
            return {"text": res.json()["candidates"][0]["content"]["parts"][0]["text"]}
    except Exception:
        raise HTTPException(502, "Gemma unavailable")
