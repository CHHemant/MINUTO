import * as MapLibreGL from "@maplibre/maplibre-react-native";
import { StyleSheet, Text, View } from "react-native";

type RouteMapProps = {
  pickup: string;
  destination: string;
  pickupCoordinate?: [number, number];
  destinationCoordinate?: [number, number];
  agentCoordinate?: [number, number];
};

const nagpurCenter: [number, number] = [79.0882, 21.1458];

export default function RouteMap({
  pickup,
  destination,
  pickupCoordinate = nagpurCenter,
  destinationCoordinate = nagpurCenter,
  agentCoordinate,
}: RouteMapProps) {
  return (
    <View style={styles.container}>
      <MapLibreGL.Map style={styles.map} mapStyle="https://tiles.openfreemap.org/styles/positron">
        <MapLibreGL.Camera
          initialViewState={{ center: destinationCoordinate, zoom: 12.5 }}
        />
        <MapLibreGL.Marker id="pickup-marker" lngLat={pickupCoordinate}>
          <View style={[styles.pin, styles.pickupPin]}><Text style={styles.pinText}>P</Text></View>
        </MapLibreGL.Marker>
        <MapLibreGL.Marker id="destination-marker" lngLat={destinationCoordinate}>
          <View style={[styles.pin, styles.destinationPin]}><Text style={styles.pinText}>D</Text></View>
        </MapLibreGL.Marker>
        {agentCoordinate ? <MapLibreGL.Marker id="agent-marker" lngLat={agentCoordinate}>
          <View style={[styles.pin, styles.agentPin]}><Text style={styles.pinText}>A</Text></View>
        </MapLibreGL.Marker> : null}
      </MapLibreGL.Map>
      <View pointerEvents="none" style={styles.mapLabel}><Text style={styles.mapLabelTitle}>OPENFREEMAP · LIVE ROUTE SURFACE</Text><Text numberOfLines={1} style={styles.mapLabelText}>{pickup} → {destination}</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: "#E9EFE9", height: 190, overflow: "hidden", position: "relative" },
  map: { flex: 1 },
  pin: { alignItems: "center", borderColor: "#FFFFFF", borderRadius: 13, borderWidth: 3, height: 26, justifyContent: "center", width: 26 },
  pickupPin: { backgroundColor: "#B18A39" },
  destinationPin: { backgroundColor: "#9D4438" },
  agentPin: { backgroundColor: "#445442" },
  pinText: { color: "#FFFFFF", fontSize: 9, fontWeight: "800" },
  mapLabel: { backgroundColor: "rgba(255,255,255,0.86)", bottom: 10, left: 10, maxWidth: "92%", paddingHorizontal: 9, paddingVertical: 7, position: "absolute" },
  mapLabelTitle: { color: "#445442", fontSize: 8, fontWeight: "800", letterSpacing: 1 },
  mapLabelText: { color: "#57554F", fontSize: 10, marginTop: 3 },
});
