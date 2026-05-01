# Parks Passport

A static website for tracking visited National Park Service sites, National Forests, and state parks on an interactive U.S. map.

## Features

- Search, state, source, and visit-status filters.
- National Parks are visually distinct from other NPS units.
- Clickable map markers and sidebar records for navigation.
- Visited parks are saved in the browser with `localStorage`.
- Export your visited list as a CSV and import shared CSVs to mark matching sites as visited.
- Clear all visited sites from the local browser state.
- Park directory data is cached locally after the first load; reload the page to refresh source data.

## Data sources

- NPS units use the public NPS Land Resources Division centroid service:
  `https://services1.arcgis.com/fBc8EJBxQRMcHlei/ArcGIS/rest/services/NPS_Land_Resources_Division_Boundary_and_Tract_Data_Service/FeatureServer/0`
- State parks and National Forests use USGS PAD-US 4.1 through the public ArcGIS REST service:
  `https://edits.nationalmap.gov/arcgis/rest/services/PAD-US/PAD_US_4_1/MapServer/0`
- Visited status is stored locally in the browser with `localStorage`.

## Run

Open `index.html` directly in a browser, or serve the folder with any static web server. The app uses CDN-hosted ArcGIS and Lucide assets, so it needs network access.

## CSV Import

The app imports its own exported CSV format, including the `Id` column for exact matching. It also accepts simpler CSVs with a `Name` column and optional `Type`, `State`, `Status`, or `Visited` columns.
