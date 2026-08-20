{
  "name": "Savaş Arenası",
  "short_name": "Savaş",
  "description": "Lobili, 20 kişiye kadar 2D tepeden bakış çok oyunculu savaş oyunu. Çevrimdışı botlara karşı da oynanır.",
  "lang": "tr",
  "dir": "ltr",
  "start_url": "./",
  "scope": "./",
  "id": "savas-arenasi",
  "display": "fullscreen",
  "display_override": ["fullscreen", "standalone", "minimal-ui"],
  "orientation": "landscape",
  "background_color": "#0a0e13",
  "theme_color": "#0a0e13",
  "categories": ["games", "action"],
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
    { "src": "icons/maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
    { "src": "icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ],
  "shortcuts": [
    {
      "name": "Çevrimdışı oyna",
      "short_name": "Çevrimdışı",
      "url": "./?mod=cevrimdisi",
      "icons": [{ "src": "icons/icon-192.png", "sizes": "192x192" }]
    }
  ]
}
