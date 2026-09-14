import { httpRouter } from 'convex/server';

import { auth } from './auth';
import { download, upload } from './collectionPhotos';

const http = httpRouter();

auth.addHttpRoutes(http);
http.route({ path: '/collection-photo', method: 'POST', handler: upload });
http.route({ path: '/collection-photo', method: 'GET', handler: download });

export default http;
