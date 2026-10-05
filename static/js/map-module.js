"use strict";

const MapModule = (() => {
  let _dtMap  = null;
  let _mobMap = null;
  let _markers = [];
  let _onSiteSelect = null;

  const TILES = {
    map: {
      url: "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png",
      attribution: '© <a href="https://stadiamaps.com/">Stadia Maps</a> © <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      subdomains: "",
      maxZoom: 20,
    },
    satellite: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution: "© Esri, Maxar, Earthstar Geographics",
      maxZoom: 19,
    },
    terrain: {
      url: "https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}{r}.png",
      attribution: '© <a href="https://stadiamaps.com/">Stadia Maps</a>',
      subdomains: "",
      maxZoom: 18,
    },
  };

  const STATUS_COLOR = {
    normal:        "#4ade80",
    needs_recheck: "#fbbf24",
    no_data:       "#6b7280",
  };
  const STATUS_GLOW = {
    normal:        "rgba(74,222,128,0.5)",
    needs_recheck: "rgba(251,191,36,0.6)",
    no_data:       "rgba(107,114,128,0.3)",
  };
  const STATUS_LABEL = {
    normal:        "Normal",
    needs_recheck: "Needs recheck",
    no_data:       "No recent data",
  };

  function _pinIcon(status, isSelected) {
    const col  = STATUS_COLOR[status] ?? "#6b7280";
    const glow = STATUS_GLOW[status]  ?? "transparent";
    const size = isSelected ? 42 : 32;
    const dot  = isSelected ? 10 : 7;
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 42 42">
        <circle cx="21" cy="21" r="19" fill="rgba(10,20,30,0.7)" stroke="${col}" stroke-width="${isSelected ? 2.5 : 1.5}"/>
        <circle cx="21" cy="21" r="${dot}" fill="${col}"
          style="filter:drop-shadow(0 0 6px ${glow})"/>
        ${isSelected
          ? `<circle cx="21" cy="21" r="14" fill="none" stroke="${col}" stroke-width="1" stroke-dasharray="3 3" opacity="0.6"/>`
          : ""}
      </svg>`;
    return L.divIcon({
      html: svg,
      className: "",
      iconSize:   [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor:[0, -(size / 2 + 4)],
    });
  }

  function _popupHtml(site) {
    const col   = STATUS_COLOR[site.status] ?? "#6b7280";
    const label = STATUS_LABEL[site.status] ?? site.status;
    return `
      <div style="min-width:180px;font-family:inherit;">
        <div style="font-size:0.95rem;font-weight:700;color:#e2f4f1;margin-bottom:4px">
          ${site.name}
        </div>
        <div style="font-size:0.72rem;color:#7fa9b5;margin-bottom:10px">
          ${site.location}
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
          <span style="width:10px;height:10px;border-radius:50%;background:${col};
            box-shadow:0 0 6px ${col};flex-shrink:0;display:inline-block;"></span>
          <span style="font-size:0.75rem;font-weight:600;color:${col}">${label}</span>
        </div>
        <button
          onclick="MapModule._selectFromPopup('${site.id}')"
          style="width:100%;padding:8px;border-radius:8px;
            background:rgba(45,212,191,0.15);border:1px solid rgba(45,212,191,0.3);
            color:#2dd4bf;font-size:0.78rem;font-weight:600;cursor:pointer;">
          View analysis →
        </button>
      </div>`;
  }

  function _drawMarkers(mapInstance, sites, selectedId) {
    sites.forEach(site => {
      const icon   = _pinIcon(site.status, site.id === selectedId);
      const marker = L.marker([site.latitude, site.longitude], { icon })
        .addTo(mapInstance)
        .bindPopup(_popupHtml(site), {
          maxWidth: 240,
          className: "sw-popup",
        })
        .bindTooltip(site.name, {
          permanent: false,
          direction: "top",
          offset: [0, -8],
        });

      marker.on("click", () => {
        if (_onSiteSelect) _onSiteSelect(site.id);
      });
      _markers.push({ id: site.id, marker, mapInstance });
    });
  }

  function _refreshMarkers(sites, selectedId) {
    _markers.forEach(({ id, marker, mapInstance }) => {
      const site = sites.find(s => s.id === id);
      if (site) {
        marker.setIcon(_pinIcon(site.status, site.id === selectedId));
        marker.setPopupContent(_popupHtml(site));
      }
    });
  }

  function _drawRiver(mapInstance, sites) {
    if (sites.length < 2) return;
    const sorted = [...sites].sort((a, b) => b.latitude - a.latitude);
    const latlngs = sorted.map(s => [s.latitude, s.longitude]);
    L.polyline(latlngs, {
      color: "#2dd4bf",
      weight: 2,
      opacity: 0.45,
      dashArray: "6 6",
      lineJoin: "round",
    }).addTo(mapInstance);
  }

  function initDesktop(containerId, sites, selectedId, onSelect) {
    _onSiteSelect = onSelect;
    const el = document.getElementById(containerId);
    if (!el) return;

    const center = sites.length
      ? [sites[0].latitude, sites[0].longitude]
      : [38.5, -96];

    _dtMap = L.map(containerId, {
      center,
      zoom: 4,
      zoomControl: false,
      attributionControl: true,
    });

    _dtMap.attributionControl.setPrefix("");

    const tileLayer = L.tileLayer(TILES.map.url, {
      attribution: TILES.map.attribution,
      maxZoom: TILES.map.maxZoom,
    }).addTo(_dtMap);

    _dtMap._currentTile = tileLayer;
    _dtMap._tiles = TILES;

    L.control.zoom({ position: "topright" }).addTo(_dtMap);

    _drawMarkers(_dtMap, sites, selectedId);
    _drawRiver(_dtMap, sites);

    if (sites.length > 1) {
      const bounds = L.latLngBounds(sites.map(s => [s.latitude, s.longitude]));
      _dtMap.fitBounds(bounds, { padding: [40, 40] });
    }

    return _dtMap;
  }

  function initMobile(containerId, sites, selectedId, onSelect) {
    _onSiteSelect = onSelect;
    const el = document.getElementById(containerId);
    if (!el || _mobMap) return;

    const center = sites.length
      ? [sites[0].latitude, sites[0].longitude]
      : [38.5, -96];

    _mobMap = L.map(containerId, {
      center,
      zoom: 4,
      zoomControl: true,
      attributionControl: false,
    });

    L.tileLayer(TILES.map.url, {
      subdomains: TILES.map.subdomains,
      maxZoom: TILES.map.maxZoom,
    }).addTo(_mobMap);

    _drawMarkers(_mobMap, sites, selectedId);

    if (sites.length > 1) {
      const bounds = L.latLngBounds(sites.map(s => [s.latitude, s.longitude]));
      _mobMap.fitBounds(bounds, { padding: [30, 30] });
    }
  }

  function switchTile(type) {
    if (!_dtMap) return;
    const cfg = TILES[type] ?? TILES.map;
    if (_dtMap._currentTile) _dtMap.removeLayer(_dtMap._currentTile);
    const opts = { attribution: cfg.attribution, maxZoom: cfg.maxZoom ?? 18 };
    if (cfg.subdomains) opts.subdomains = cfg.subdomains;
    _dtMap._currentTile = L.tileLayer(cfg.url, opts).addTo(_dtMap);
    _dtMap._currentTile.bringToBack();
  }

  function focusSite(siteId, sites) {
    const site = sites.find(s => s.id === siteId);
    if (!site || !_dtMap) return;
    _dtMap.setView([site.latitude, site.longitude], 9, { animate: true });
    const entry = _markers.find(m => m.id === siteId && m.mapInstance === _dtMap);
    if (entry) {
      entry.marker.openPopup();
      _refreshMarkers(sites, siteId);
    }
  }

  function _selectFromPopup(siteId) {
    if (_onSiteSelect) _onSiteSelect(siteId);
  }

  function invalidate() {
    if (_dtMap)  setTimeout(() => _dtMap.invalidateSize(), 50);
    if (_mobMap) setTimeout(() => _mobMap.invalidateSize(), 50);
  }

  return { initDesktop, initMobile, switchTile, focusSite, invalidate, _selectFromPopup };
})();
