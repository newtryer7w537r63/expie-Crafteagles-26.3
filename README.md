# expie-Crafteagles-26.3
experimental version of eaglercraft 26.2 that aims to make the game run much much faster.
WARNING is HEAVILY WIP
is in ALPHA STAGES
do not expect this project to be done soon
has lots of debug options so you can fix it if its not working for you

logs-

-added a WebGL2 command-stream optimizer to remove redundant GPU state changes, caches lookups that cost a round trip, and requests the high-performance GPU, Codename, Zephyr.
Zephyr description, drops repeat binds of buffers, textures, programs and framebuffers. It does the same for repeat enable/disable, blend, viewport and mask settings, vertex-attribute setup and uniform uploads. A call is only skipped when it repeats the exact arguments of the last one. Caches lookups. getUniformLocation, getAttribLocation, getExtension and constant getParameter values are remembered, since these can cost a GPU round trip. Asks for the high-performance GPU on laptops with two GPUs, and caps devicePixelRatio at 2 so 3x phone and hi-DPI screens render fewer pixels. WebGL2 only. I left WebGL1 alone because its extensions can change state behind the optimizer’s back and thats not good.
