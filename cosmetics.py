"""Power-up definitions and bounded validation of browser-normalized PNGs."""
import base64
import binascii
import struct
import zlib

POWERUPS = {
    'speed': {'name': 'Speed', 'symbol': '⚡', 'description': 'Move at 1.6× speed for 5 seconds.'},
    'shield': {'name': 'Shield', 'symbol': '🛡️', 'description': 'Lay protected trail segments for 5 seconds. Each segment stays protected for 3 seconds.'},
    'frost': {'name': 'Frost', 'symbol': '🧊', 'description': 'Slow rivals within 14 cells (Manhattan distance) to 0.55× speed for 3 seconds.'},
    'teleport': {'name': 'Dash recharge', 'symbol': '🌀', 'description': 'Immediately reset your dash cooldown. Space activates a 0.18-second, 4× burst from home territory; normal cooldown is 12 seconds.'},
    'radar': {'name': 'Radar', 'symbol': '👀', 'description': 'See the full board for 10 seconds instead of the usual 19-cell radius.'},
}
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
IMAGE_BYTES_LIMIT = 128 * 1024
UPLOAD_BODY_LIMIT = 180 * 1024


def decode_png(value):
    """Only accept static, normalized 128×128 RGB/RGBA PNGs; discard metadata."""
    if not isinstance(value, str) or not value.startswith('data:image/png;base64,'):
        raise ValueError('Choose an image using the upload control')
    if len(value) > UPLOAD_BODY_LIMIT:
        raise ValueError('Image is too large')
    try:
        raw = base64.b64decode(value.split(',', 1)[1], validate=True)
    except (ValueError, binascii.Error):
        raise ValueError('Invalid PNG data') from None
    if len(raw) > IMAGE_BYTES_LIMIT or not raw.startswith(PNG_SIGNATURE):
        raise ValueError('Invalid or oversized PNG')
    offset = len(PNG_SIGNATURE)
    header = None
    compressed = bytearray()
    ended = False
    chunks = []
    while offset + 12 <= len(raw):
        size = struct.unpack('>I', raw[offset:offset+4])[0]
        kind = raw[offset+4:offset+8]
        end = offset+12+size
        if end > len(raw):raise ValueError('Truncated PNG')
        content = raw[offset+8:offset+8+size]
        crc = struct.unpack('>I', raw[offset+8+size:end])[0]
        if zlib.crc32(kind+content) & 0xffffffff != crc:raise ValueError('Corrupt PNG')
        if header is None and kind != b'IHDR':raise ValueError('Missing PNG header')
        if kind == b'IHDR':
            if header is not None or size != 13:raise ValueError('Invalid PNG header')
            header = struct.unpack('>IIBBBBB', content)
            width, height, depth, color, compression, filtering, interlace = header
            if (width, height, depth, compression, filtering, interlace) != (128,128,8,0,0,0) or color not in (2,6):
                raise ValueError('Upload a normalized 128×128 PNG using the image picker')
            chunks.append(raw[offset:end])
        elif kind == b'IDAT':
            compressed.extend(content)
        elif kind == b'IEND':
            if size or end != len(raw):raise ValueError('Invalid PNG end')
            ended = True
            break
        elif kind == b'acTL' or not kind[0] & 32:
            raise ValueError('Unsupported PNG format')
        offset = end
    if not ended or not compressed:raise ValueError('Incomplete PNG')
    stride = 128 * (4 if header[3] == 6 else 3) + 1
    expected = stride * 128
    try:
        decoder = zlib.decompressobj()
        pixels = decoder.decompress(bytes(compressed), expected+1)
    except zlib.error:
        raise ValueError('Invalid PNG pixels') from None
    if len(pixels) != expected or not decoder.eof or decoder.unused_data or any(pixels[i] > 4 for i in range(0,expected,stride)):
        raise ValueError('Invalid PNG pixels')
    # Keep only the essential chunks, so uploaded metadata is never stored.
    def chunk(kind, data):
        return struct.pack('>I', len(data))+kind+data+struct.pack('>I', zlib.crc32(kind+data)&0xffffffff)
    return PNG_SIGNATURE + chunks[0] + chunk(b'IDAT', bytes(compressed)) + chunk(b'IEND', b'')
