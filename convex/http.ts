import { httpRouter } from "convex/server";

import { auth } from "./auth";
import { download, upload } from "./collectionPhotos";
import { download as displayMedia } from "./displayMedia";
import { download as fileDownload } from "./files";
import { licenses, privacy, support, terms } from "./legal";
import { playlist as narrationPlaylist } from "./narration";

const http = httpRouter();

auth.addHttpRoutes(http);
http.route({ path: "/collection-photo", method: "POST", handler: upload });
http.route({ path: "/collection-photo", method: "GET", handler: download });
http.route({ path: "/display-media", method: "GET", handler: displayMedia });
http.route({ path: "/file", method: "GET", handler: fileDownload });
http.route({ path: "/narration-playlist", method: "GET", handler: narrationPlaylist });
http.route({ path: "/privacy", method: "GET", handler: privacy });
http.route({ path: "/terms", method: "GET", handler: terms });
http.route({ path: "/support", method: "GET", handler: support });
http.route({ path: "/licenses", method: "GET", handler: licenses });

export default http;
