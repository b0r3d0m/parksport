# Parks Passport

A static website for tracking visited National Park Service sites, National Forests, and state parks on an interactive U.S. map.

## Features

- Search, state, source, and visit-status filters.
- National Parks are visually distinct from other NPS units.
- Clickable map markers and sidebar records for navigation.
- Visited parks are saved in the browser with `localStorage`.
- Export your visited list as a CSV and import shared CSVs to mark matching sites as visited.
- Clear all visited sites from the local browser state.
- Optional official NPS API import with a free `developer.nps.gov` key.

## Data sources

- State parks, National Forests, and the default NPS layer use USGS PAD-US 4.1 through the public ArcGIS REST service:
  `https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US_4_1/MapServer/0`
- An optional NPS API key can load the official NPS parks directory from:
  `https://developer.nps.gov/api/v1/parks`
- Visited status is stored locally in the browser with `localStorage`.

## Run

Open `index.html` directly in a browser, or serve the folder with any static web server. The app uses CDN-hosted ArcGIS and Lucide assets, so it needs network access.

## CSV Import

The app imports its own exported CSV format, including the `Id` column for exact matching. It also accepts simpler CSVs with a `Name` column and optional `Type`, `State`, `Status`, or `Visited` columns.
