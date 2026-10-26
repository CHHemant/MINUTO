import { StyleSheet, Text, View } from "react-native";

type RouteMapProps = {
  pickup: string;
  destination: string;
  pickupCoordinate?: [number, number];
  destinationCoordinate?: [number, number];
  agentCoordinate?: [number, number];
};

export default function RouteMap({ pickup, destination, agentCoordinate }: RouteMapProps) {
  return (
    <View style={styles.container}>
      <View style={styles.roadOne} /><View style={styles.roadTwo} /><View style={styles.roadThree} />
      <View style={[styles.pin, styles.pickupPin]}><Text style={styles.pinText}>P</Text></View>
      <View style={[styles.pin, styles.destinationPin]}><Text style={styles.pinText}>D</Text></View>
      {agentCoordinate ? <View style={[styles.pin, styles.agentPin]}><Text style={styles.pinText}>A</Text></View> : null}
      <View style={styles.routeLine} />
      <View style={styles.mapLabel}><Text style={styles.mapLabelTitle}>OPENFREEMAP · NATIVE MAP READY</Text><Text numberOfLines={1} style={styles.mapLabelText}>{pickup} → {destination}</Text></View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: "#E9EFE9", height: 190, overflow: "hidden", position: "relative" },
  roadOne: { backgroundColor: "#FFFFFF", height: 14, left: -20, position: "absolute", top: 65, transform: [{ rotate: "19deg" }], width: "120%" },
  roadTwo: { backgroundColor: "#FFFFFF", height: 10, left: -20, position: "absolute", top: 122, transform: [{ rotate: "-24deg" }], width: "120%" },
  roadThree: { backgroundColor: "#D4E0D3", height: 4, left: -20, position: "absolute", top: 36, transform: [{ rotate: "-8deg" }], width: "120%" },
  routeLine: { borderColor: "#445442", borderRadius: 40, borderRightWidth: 3, borderTopWidth: 3, height: 90, left: "28%", position: "absolute", top: 48, transform: [{ rotate: "17deg" }], width: "44%" },
  pin: { alignItems: "center", borderColor: "#FFFFFF", borderRadius: 13, borderWidth: 3, height: 26, justifyContent: "center", position: "absolute", width: 26, zIndex: 2 },
  pickupPin: { backgroundColor: "#B18A39", left: "18%", top: 39 },
  destinationPin: { backgroundColor: "#9D4438", right: "17%", top: 122 },
  agentPin: { backgroundColor: "#445442", left: "50%", top: 82 },
  pinText: { color: "#FFFFFF", fontSize: 9, fontWeight: "800" },
  mapLabel: { backgroundColor: "rgba(255,255,255,0.86)", bottom: 10, left: 10, maxWidth: "92%", paddingHorizontal: 9, paddingVertical: 7, position: "absolute" },
  mapLabelTitle: { color: "#445442", fontSize: 8, fontWeight: "800", letterSpacing: 1 },
  mapLabelText: { color: "#57554F", fontSize: 10, marginTop: 3 },
});
