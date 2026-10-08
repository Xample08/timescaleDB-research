"use client";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import type { FleetVehicle } from "@/lib/fleet";
import { validPosition, vehicleState } from "@/lib/fleet";
import "leaflet/dist/leaflet.css";
export default function FleetMap({
  vehicles,
  checkedAt,
  warningIds,
  selected,
  onSelect,
  target,
}: {
  vehicles: FleetVehicle[];
  checkedAt: string;
  warningIds: number[];
  selected: number | null;
  onSelect: (id: number) => void;
  target: "pg" | "ts";
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<Leaflet.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [tilesFailed, setTilesFailed] = useState(false);
  const fitted = useRef(false);
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver;
    import("leaflet").then((L) => {
      if (cancelled || !element.current) return;
      const instance = L.map(element.current).setView([-6.2, 106.8166], 11);
      map.current = instance;
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      })
        .on("tileerror", () => setTilesFailed(true))
        .addTo(instance);
      observer = new ResizeObserver(() => instance.invalidateSize());
      observer.observe(element.current);
      setReady(true);
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ready || !map.current) return;
    const instance = map.current;
    let layer: Leaflet.LayerGroup;
    let cancelled = false;
    import("leaflet").then((L) => {
      if (cancelled) return;
      layer = L.layerGroup().addTo(instance);
      const points: Leaflet.LatLngTuple[] = [];
      for (const v of vehicles.filter(validPosition)) {
        const point: Leaflet.LatLngTuple = [v.latitude!, v.longitude!];
        points.push(point);
        const stale = ["Stale", "No data"].includes(vehicleState(v, checkedAt));
        const color = warningIds.includes(v.id)
          ? "#fbbf24"
          : stale
            ? "#94a3b8"
            : target === "pg"
              ? "#60a5fa"
              : "#2dd4bf";
        const content = document.createElement("span");
        content.textContent = `${v.plate} / ${vehicleState(v, checkedAt)} / ${v.speed ?? "Unknown"} km/h`;
        const hasWarning = warningIds.includes(v.id);
        const isSelected = selected === v.id;
        const marker = document.createElement("div");
        marker.className = `vehicle-map-symbol${stale ? " is-stale" : ""}${isSelected ? " is-selected" : ""}`;
        marker.style.setProperty("--vehicle-color", color);
        const car = document.createElementNS(
          "http://www.w3.org/2000/svg",
          "svg",
        );
        car.setAttribute("viewBox", "0 0 32 40");
        car.setAttribute("aria-hidden", "true");
        car.classList.add("vehicle-map-car");
        car.style.transform = `rotate(${Number.isFinite(v.heading) ? v.heading : 0}deg)`;
        car.innerHTML =
          '<rect x="5" y="13" width="4" height="7" rx="1.5" fill="#050c16"/><rect x="23" y="13" width="4" height="7" rx="1.5" fill="#050c16"/><rect x="5" y="27" width="4" height="7" rx="1.5" fill="#050c16"/><rect x="23" y="27" width="4" height="7" rx="1.5" fill="#050c16"/><rect x="8" y="8" width="16" height="29" rx="5" fill="currentColor"/><path d="m11 16 1-4h8l1 4z" fill="#142136"/><rect x="11" y="18" width="10" height="9" rx="2" fill="#142136"/><path d="m11 29 1 4h8l1-4z" fill="#142136"/><path d="M10 10h3m6 0h3" stroke="#f8fafc" stroke-width="2" stroke-linecap="round"/><path d="M10 35h3m6 0h3" stroke="#fb7185" stroke-width="1.5" stroke-linecap="round"/>';
        marker.append(car);
        L.marker(point, {
          icon: L.divIcon({
            html: marker,
            className: "vehicle-map-marker",
            iconSize: [38, 38],
            iconAnchor: [19, 19],
            tooltipAnchor: [0, -22],
          }),
          title: `${v.plate}${hasWarning ? " / Active warning" : ""} / ${vehicleState(v, checkedAt)}`,
          alt: `Vehicle ${v.plate}`,
          zIndexOffset: isSelected ? 1000 : hasWarning ? 500 : 0,
          riseOnHover: true,
        })
          .bindTooltip(content)
          .on("click", () => onSelect(v.id))
          .addTo(layer);
      }
      if (points.length && !fitted.current) {
        instance.fitBounds(L.latLngBounds(points), {
          padding: [30, 30],
          maxZoom: 14,
        });
        fitted.current = true;
      }
      const vehicle = vehicles.find((v) => v.id === selected);
      if (vehicle && validPosition(vehicle))
        instance.panTo([vehicle.latitude!, vehicle.longitude!]);
    });
    return () => {
      cancelled = true;
      layer?.remove();
    };
  }, [ready, vehicles, checkedAt, warningIds, selected, onSelect, target]);
  return (
    <div className="fleet-map-wrap">
      <div
        ref={element}
        className="fleet-map"
        aria-label="Vehicle location map"
      />
      {tilesFailed && (
        <div className="map-notice">
          Map tiles unavailable. Vehicle coordinates are still listed.
        </div>
      )}
      <div className="map-legend">
        <span>
          <i className="map-legend-dot" />
          Current
        </span>
        <span className="amber">
          <i className="map-legend-dot" />
          Warning
        </span>
        <span className="muted">
          <i className="map-legend-dot" />
          Stale
        </span>
      </div>
    </div>
  );
}
