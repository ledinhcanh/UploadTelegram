const chunkPromises = new Map();

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
    if (event.data.type === 'CHUNK_RESPONSE') {
        const { reqId, chunk, error, totalSize, mimeType } = event.data;
        if (chunkPromises.has(reqId)) {
            const resolve = chunkPromises.get(reqId);
            resolve({ chunk, error, totalSize, mimeType });
            chunkPromises.delete(reqId);
        }
    }
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.pathname.startsWith('/tg-stream/')) {
        event.respondWith(handleStream(event.request, url.pathname));
    }
});

async function handleStream(request, pathname) {
    const fileIdStr = pathname.split('/tg-stream/')[1];
    if (!fileIdStr) return new Response('Not found', { status: 404 });

    const reqId = Math.random().toString(36).substring(7);
    const rangeHeader = request.headers.get('Range') || 'bytes=0-';
    
    // Notify main thread
    const clientsList = await self.clients.matchAll();
    if (clientsList.length === 0) return new Response('No client active', { status: 404 });
    
    const promise = new Promise(resolve => chunkPromises.set(reqId, resolve));
    
    clientsList[0].postMessage({
        type: 'REQUEST_CHUNK',
        reqId,
        fileIdStr,
        rangeHeader
    });

    const { chunk, error, totalSize, mimeType } = await promise;
    
    if (error) {
        console.error("SW Chunk Error", error);
        return new Response('Error fetching chunk', { status: 500 });
    }

    const [startStr, endStr] = rangeHeader.replace(/bytes=/, "").split("-");
    const start = parseInt(startStr, 10);
    const end = endStr && endStr !== "" ? parseInt(endStr, 10) : start + chunk.byteLength - 1;

    return new Response(chunk, {
        status: 206,
        headers: {
            "Content-Range": `bytes ${start}-${start + chunk.byteLength - 1}/${totalSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": chunk.byteLength,
            "Content-Type": mimeType || "video/mp4"
        }
    });
}
