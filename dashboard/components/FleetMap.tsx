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
        L.circleMarker(point, {
          radius: selected === v.id ? 11 : 7,
          color,
          weight: selected === v.id ? 4 : 2,
          fillColor: color,
          fillOpacity: stale ? 0.35 : 0.8,
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
        <span>Current</span>
        <span className="amber">Warning</span>
        <span className="muted">Stale</span>
      </div>
    </div>
  );
}
