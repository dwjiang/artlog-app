import { httpRouter } from 'convex/server';

import { auth } from './auth';
import { download, upload } from './collectionPhotos';
import { download as displayMedia } from './displayMedia';

const http = httpRouter();

auth.addHttpRoutes(http);
http.route({ path: '/collection-photo', method: 'POST', handler: upload });
http.route({ path: '/collection-photo', method: 'GET', handler: download });
http.route({ path: '/display-media', method: 'GET', handler: displayMedia });

export default http;
