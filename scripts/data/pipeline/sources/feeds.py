"""On-view feeds by source name; each module has OWNER_KEY, ROBOTS and fetch(client, out)."""

from . import gardner, louvre, ng, reina, rijks, thyssen, vgm, wallace

FEEDS = {
    "gardner": gardner,
    "louvre": louvre,
    "ng": ng,
    "reina": reina,
    "rijks": rijks,
    "thyssen": thyssen,
    "vgm": vgm,
    "wallace": wallace,
}
