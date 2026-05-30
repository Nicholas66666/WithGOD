update storage.buckets
set allowed_mime_types = array[
  'audio/mp4',
  'audio/m4a',
  'audio/mpeg',
  'audio/aac',
  'audio/wav',
  'audio/x-wav',
  'audio/aiff',
  'audio/x-aiff',
  'application/octet-stream'
]
where id = 'presence-audio';
