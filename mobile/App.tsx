import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type Session } from "@supabase/supabase-js";
import * as ImagePicker from "expo-image-picker";
import * as Clipboard from "expo-clipboard";
import * as Location from "expo-location";
import { useFonts } from "expo-font";
import {
  PlayfairDisplay_400Regular,
  PlayfairDisplay_500Medium,
  PlayfairDisplay_600SemiBold,
} from "@expo-google-fonts/playfair-display";
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from "@expo-google-fonts/manrope";
import { StatusBar } from "expo-status-bar";
import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Alert,
  Image,
  ImageBackground,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { normalizeIndianPhone, validateSellerPaymentDetails, validateSupabaseConfig } from "./src/lib/validation";
import RouteMap from "./src/components/RouteMap";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
const BACKEND_CONFIG_KEY = "minuto-supabase-config-v1";
const agentPreviewEnabled = process.env.EXPO_PUBLIC_AGENT_PREVIEW === "true" && process.env.NODE_ENV !== "production";
const deliveryJobSelect = "id,order_id,vendor_id,vendor_name,vendor_address,buyer_name,buyer_phone,buyer_address,buyer_area,buyer_postal_code,status,agent_id,payout_rate_per_km,distance_km,agent_payout,delivery_proof_note,delivery_proof_photo_path,delivered_at,vendor_latitude,vendor_longitude,buyer_latitude,buyer_longitude,created_at";

function makeSupabaseClient(url: string, key: string) {
  return createClient(url, key, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === "web",
    },
  });
}

const supabaseClient =
  supabaseUrl?.startsWith("https://") && supabaseKey && !supabaseKey.startsWith("your-")
    ? makeSupabaseClient(supabaseUrl, supabaseKey)
    : null;

type Role = "buyer" | "vendor" | "agent";
type ProductCategory = "fresh" | "pantry" | "tech" | "style";
type Profile = {
  id: string;
  display_name: string;
  email: string;
  role: Role | null;
  marketplace_approval_status: "pending" | "approved" | "rejected" | "suspended" | "banned";
  marketplace_approval_note: string | null;
  pickup_address?: string | null;
  seller_upi_id?: string | null;
  seller_phone?: string | null;
};
type ActiveProfile = Profile & { role: Role };
type Product = {
  id: string;
  vendor_id: string;
  vendor_name: string;
  name: string;
  details: string;
  category: ProductCategory;
  seller_price: number;
  stock: number;
  image_path: string;
  image_url: string;
  active: boolean;
  delivery_proof_note: string | null;
  delivery_proof_photo_path: string | null;
  delivered_at: string | null;
  created_at: string;
};
type Cart = Record<string, number>;
type BuyerOrder = {
  id: string;
  total: number;
  payment_method: "cod" | "upi";
  payment_status: "not_required" | "pending" | "paid" | "failed" | "expired" | "cancelled" | "review" | "refunded";
  payment_review_required: boolean;
  payment_utr: string | null;
  created_at: string;
};
type SellerPayout = {
  id: string;
  order_id: string;
  gross_amount: number;
  delivery_contribution: number;
  amount: number;
  status: "pending" | "paid" | "not_due";
  transfer_reference: string | null;
  created_at: string;
};
type DeliveryJob = {
  id: string;
  order_id: string;
  vendor_id: string;
  vendor_name: string;
  vendor_address: string;
  buyer_name: string;
  buyer_phone: string;
  buyer_address: string;
  buyer_area: string;
  buyer_postal_code: string;
  status: string;
  payout_rate_per_km: number;
  distance_km: number | null;
  agent_payout: number | null;
  agent_id: string | null;
  vendor_latitude: number | null;
  vendor_longitude: number | null;
  buyer_latitude: number | null;
  buyer_longitude: number | null;
  created_at: string;
};
type AgentLocation = {
  agent_id: string;
  latitude: number;
  longitude: number;
  updated_at: string;
};
type AppNotification = {
  id: string;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};
type PendingApplicant = {
  id: string;
  display_name: string;
  email: string;
  role: "vendor" | "agent";
  marketplace_approval_status: "pending" | "approved" | "rejected" | "suspended" | "banned";
  seller_upi_id: string | null;
  seller_phone: string | null;
  created_at: string;
};
type ManagedAccount = PendingApplicant & {
  marketplace_approval_status: "pending" | "approved" | "rejected" | "suspended" | "banned";
  marketplace_approval_note: string | null;
};
type FinancePayout = SellerPayout & {
  vendor_id: string;
  seller_upi_id: string;
  seller_phone: string;
};
type ReconciliationCase = {
  payment_id: string;
  order_id: string;
  amount_paise: number;
  reason: string;
  status: "open" | "resolved";
  created_at: string;
};
type FinanceAuditEntry = {
  id: string;
  action: string;
  entity_id: string;
  created_at: string;
};
type AuditFilter = "all" | "trust" | "finance" | "services";
type SellerOrderFilter = "active" | "history";
type AdminServiceProvider = {
  id: string;
  category: EverydayService["category"];
  name: string;
  description: string;
  service_area: string;
  starting_price: number;
  verified: boolean;
  active: boolean;
};
type AdminServiceBooking = {
  id: string;
  category: EverydayService["category"];
  requested_for: string;
  address: string;
  notes: string;
  status: "requested" | "confirmed" | "in_progress" | "completed" | "cancelled";
  buyer_id: string;
  provider_id: string;
  service_providers: { name: string }[] | null;
};
type EverydayService = {
  id: string;
  category: "grooming" | "vehicle" | "home" | "errands";
  title: string;
  description: string;
  provider: string;
  meta: string;
  action: string;
};
type ServiceProvider = {
  id: string;
  category: EverydayService["category"];
  name: string;
  description: string;
  service_area: string;
  starting_price: number;
  rating: number;
  review_count: number;
  verified: boolean;
};
type SavedAddress = {
  id: string;
  label: string;
  address: string;
  area: string;
  postal_code: string;
};
type ServiceBooking = {
  id: string;
  category: EverydayService["category"];
  requested_for: string;
  address: string;
  status: string;
  service_providers: { name: string }[] | null;
  service_reviews: { rating: number; review: string }[] | null;
};
type LifeReminder = {
  id: string;
  title: string;
  due_at: string | null;
  completed: boolean;
};

const palette = {
  background: "#FAF9F5",
  white: "#FFFFFF",
  ink: "#292A24",
  muted: "#77766D",
  line: "#E7E3DA",
  green: "#445442",
  soft: "#EFEEE7",
  error: "#9D4438",
};
const categories = ["fresh", "pantry", "tech", "style"];
const labelForRole: Record<Role, string> = {
  buyer: "Buyer",
  vendor: "Local vendor",
  agent: "Delivery agent",
};
const everydayServices: EverydayService[] = [
  {
    id: "barber",
    category: "grooming",
    title: "Barber appointments",
    description: "Book a trusted barber for a cut, beard trim, or quick refresh.",
    provider: "Verified local barbers",
    meta: "From ₹199 · Today",
    action: "Choose a time",
  },
  {
    id: "mechanic",
    category: "vehicle",
    title: "Nearby mechanics",
    description: "Get roadside help or find a mechanic when your vehicle needs attention.",
    provider: "Mobile and local garages",
    meta: "Usually within 30 min",
    action: "Find help",
  },
  {
    id: "home",
    category: "home",
    title: "Home essentials",
    description: "Book cleaning, appliance repair, electrician, and plumbing help.",
    provider: "Background-checked pros",
    meta: "Schedule this week",
    action: "Browse help",
  },
  {
    id: "errands",
    category: "errands",
    title: "Everyday errands",
    description: "Delegate pickup, drop-off, laundry, and other small tasks.",
    provider: "Reliable local helpers",
    meta: "Simple, on-demand",
    action: "Plan an errand",
  },
];
const quickActions = [
  ["services", "Book a service", "Barber, mechanic, home help"],
  ["shop", "Order essentials", "Groceries and local finds"],
  ["services", "Get help now", "Roadside and urgent support"],
  ["activity", "Manage my life", "Bookings, reminders, rewards"],
] as const;

function formatMoney(amount: number) {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function auditMeta(action: string) {
  if (action.includes("payout") || action.includes("payment")) {
    return {
      group: "FINANCE",
      label: action.includes("payout") ? "Seller payout recorded" : "Payment case resolved",
      detail: action.includes("payout") ? "A seller transfer was marked as completed." : "A payment exception was closed with an admin resolution.",
      icon: "₹",
      color: "#B18A39",
      filter: "finance" as const,
    };
  }
  if (action.includes("service_provider")) {
    return {
      group: "SERVICES",
      label: "Service provider published",
      detail: "A new local service was added to the buyer marketplace.",
      icon: "+",
      color: "#66816B",
      filter: "services" as const,
    };
  }
  return {
    group: "TRUST",
    label: action.includes("invite_code")
      ? action.includes("redeemed") ? "Invite code redeemed" : "Invite code created"
      : action.replaceAll("_", " "),
    detail: action.includes("invite_code")
      ? "A controlled access code changed the operator onboarding record."
      : "An account access decision was recorded for future review.",
    icon: "✓",
    color: "#6D8497",
    filter: "trust" as const,
  };
}

function formatAuditDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function messageFor(error: unknown) {
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
      ? error.message
      : "";
  if (rawMessage.toLowerCase().includes("could not find the table 'public.profiles'")) {
    return "The Supabase database is not initialized. Open Supabase SQL Editor and run mobile/supabase/schema.sql, then reload Minuto.";
  }
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    const details = "details" in error && typeof error.details === "string" ? ` ${error.details}` : "";
    const hint = "hint" in error && typeof error.hint === "string" ? ` ${error.hint}` : "";
    return `${error.message}${details}${hint}`.trim();
  }
  return "Something went wrong. Please try again.";
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled Minuto rendering error", error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.brand}>minuto</Text>
          <Text style={styles.heading}>Something went wrong.</Text>
          <Text style={styles.paragraph}>The app could not display this screen. Restart Minuto and try again.</Text>
          <Button title="Try again" onPress={() => this.setState({ hasError: false })} />
        </View>
      </SafeAreaView>
    );
  }
}

function SetupScreen({ onConnect }: { onConnect: (url: string, key: string) => Promise<void> }) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>minuto</Text>
        <Text style={styles.heading}>Connect your project.</Text>
        <Text style={styles.paragraph}>
          Create a Supabase project, run mobile/supabase/schema.sql in its SQL Editor, then enter its project URL and publishable key.
        </Text>
        <Field label="Supabase project URL" value={url} onChangeText={setUrl} placeholder="https://your-project.supabase.co" keyboard="email-address" />
        <Field label="Publishable / anon key" value={key} onChangeText={setKey} placeholder="sb_publishable_…" secure />
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <Button title={busy ? "Connecting…" : "Connect backend"} disabled={busy} onPress={() => {
          setError("");
          setBusy(true);
          void onConnect(url, key).catch((reason: unknown) => setError(messageFor(reason))).finally(() => setBusy(false));
        }} />
        <Text style={styles.note}>Use only a publishable/anon key. Never enter a service-role or secret key. This connection is saved on this phone.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  secure?: boolean;
  keyboard?: "default" | "email-address" | "phone-pad" | "number-pad";
  multiline?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        accessibilityLabel={props.label}
        autoCapitalize={props.autoCapitalize ?? (props.keyboard === "email-address" ? "none" : "sentences")}
        autoCorrect={false}
        keyboardType={props.keyboard ?? "default"}
        multiline={props.multiline}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor="#99968C"
        secureTextEntry={props.secure}
        style={[styles.input, props.multiline && styles.multiline]}
        value={props.value}
      />
    </View>
  );
}

function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, secondary && styles.buttonSecondary, disabled && styles.disabled]}
    >
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{title}</Text>
    </Pressable>
  );
}

function AuthScreen({ client }: { client: NonNullable<typeof supabaseClient> }) {
  const [creating, setCreating] = useState(false);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmationEmail, setConfirmationEmail] = useState("");

  function authErrorMessage(reason: unknown) {
    const message = messageFor(reason);
    const normalized = message.toLowerCase();
    if (normalized.includes("email not confirmed")) {
      return "Your email is not confirmed yet. Use the button below to send a new confirmation email.";
    }
    if (normalized.includes("user already registered")) {
      return "An account already exists for this email. Switch to sign in, or resend the confirmation email below.";
    }
    if (normalized.includes("invalid login credentials")) {
      return "The email or password is incorrect. Check both details and try again.";
    }
    return message;
  }

  async function submit() {
    setError("");
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || password.length < 8) {
      setError("Enter a valid email and a password with at least 8 characters.");
      return;
    }
    if (creating && name.trim().length < 2) {
      setError("Enter your name.");
      return;
    }
    setBusy(true);
    try {
      const result = creating
        ? await client.auth.signUp({
            email: normalizedEmail,
            password,
            options: {
              data: { display_name: name.trim() },
              ...(Platform.OS === "web" && typeof window !== "undefined"
                ? { emailRedirectTo: window.location.origin }
                : {}),
            },
          })
        : await client.auth.signInWithPassword({ email: normalizedEmail, password });
      if (result.error) throw result.error;
      if (creating && !result.data.session) {
        setConfirmationEmail(normalizedEmail);
        setError("Account created. Check your email to confirm your account, then sign in.");
      } else {
        setConfirmationEmail("");
      }
    } catch (reason) {
      setError(authErrorMessage(reason));
      if (creating || messageFor(reason).toLowerCase().includes("email not confirmed")) {
        setConfirmationEmail(normalizedEmail);
      }
    } finally {
      setBusy(false);
    }
  }

  async function resendConfirmation() {
    const normalizedEmail = confirmationEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Enter your email first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: resendError } = await client.auth.resend({
        type: "signup",
        email: normalizedEmail,
        options: Platform.OS === "web" && typeof window !== "undefined"
          ? { emailRedirectTo: window.location.origin }
          : undefined,
      });
      if (resendError) throw resendError;
      setError("A new confirmation email has been sent. Check your inbox and spam folder.");
    } catch (reason) {
      setError(authErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  async function sendPasswordReset() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError("Enter the email address for your Minuto account.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: resetError } = await client.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: Platform.OS === "web" && typeof window !== "undefined"
          ? window.location.origin
          : undefined,
      });
      if (resetError) throw resetError;
      setError("If an account exists for this email, a password reset link has been sent. Check your inbox and spam folder.");
    } catch (reason) {
      setError(authErrorMessage(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.brand}>minuto</Text>
          <Text style={styles.kicker}>LOCAL VENDORS · NAGPUR</Text>
            <Text style={styles.heading}>{forgotPassword ? "Reset your password." : creating ? "A good place to begin." : "Welcome back."}</Text>
            {forgotPassword ? <Text style={styles.paragraph}>Enter your email and we’ll send you a secure password reset link.</Text> : null}
            {creating && !forgotPassword && <Field label="Your name" value={name} onChangeText={setName} placeholder="Name" />}
            <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboard="email-address" />
            {!forgotPassword && <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secure />}
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            {confirmationEmail && !forgotPassword ? <Button title={busy ? "Sending…" : "Resend confirmation email"} secondary disabled={busy} onPress={() => void resendConfirmation()} /> : null}
            <Button title={busy ? "Please wait…" : forgotPassword ? "Send reset email" : creating ? "Create account" : "Sign in"} onPress={() => void (forgotPassword ? sendPasswordReset() : submit())} disabled={busy} />
            {!creating && !forgotPassword ? <Pressable onPress={() => { setForgotPassword(true); setError(""); setConfirmationEmail(""); }}><Text style={styles.link}>Forgot password?</Text></Pressable> : null}
            <Pressable onPress={() => { setForgotPassword(false); setCreating(!creating); setError(""); }}>
              <Text style={styles.link}>{forgotPassword ? "Back to sign in" : creating ? "Already registered? Sign in" : "New to Minuto? Create an account"}</Text>
            </Pressable>
          <Text style={styles.note}>Vendor and delivery-agent accounts require review before they can use marketplace features.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PasswordResetScreen({
  client,
  onComplete,
}: {
  client: NonNullable<typeof supabaseClient>;
  onComplete: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function updatePassword() {
    if (password.length < 8) {
      setError("Use a password with at least 8 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: updateError } = await client.auth.updateUser({ password });
      if (updateError) throw updateError;
      onComplete();
    } catch (reason) {
      setError(messageFor(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.brand}>minuto</Text>
          <Text style={styles.heading}>Choose a new password.</Text>
          <Text style={styles.paragraph}>Your reset link is verified. Set a new password to continue using Minuto.</Text>
          <Field label="New password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secure />
          <Field label="Confirm new password" value={confirmation} onChangeText={setConfirmation} placeholder="Repeat your password" secure />
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <Button title={busy ? "Updating…" : "Update password"} disabled={busy} onPress={() => void updatePassword()} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function RoleScreen({
  profile,
  onDone,
}: {
  profile: Profile;
  onDone: (name: string, role: Role, inviteCode: string) => Promise<void>;
}) {
  const [name, setName] = useState(profile.display_name);
  const [role, setRole] = useState<Role>("buyer");
  const [inviteCode, setInviteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.authScroll}>
        <Text style={styles.brand}>minuto</Text>
        <Text style={styles.heading}>How will you use Minuto?</Text>
        <Field label="Your name" value={name} onChangeText={setName} placeholder="Name" />
        {(["buyer", "vendor", "agent"] as Role[]).map((choice) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: role === choice }}
            key={choice}
            onPress={() => setRole(choice)}
            style={[styles.roleCard, role === choice && styles.roleCardSelected]}
          >
            <Text style={styles.cardTitle}>{labelForRole[choice]}</Text>
            <Text style={styles.paragraph}>
              {choice === "buyer" ? "Shop from independent local vendors." :
                choice === "vendor" ? "Request seller approval, then list products and prepare orders." :
                  "Request delivery-agent approval, then accept nearby delivery jobs."}
            </Text>
          </Pressable>
        ))}
        {role !== "buyer" ? <Field label="Admin invite code" value={inviteCode} onChangeText={setInviteCode} placeholder="Enter the code from Minuto admin" autoCapitalize="characters" /> : null}
        {role !== "buyer" ? <Text style={styles.note}>Seller and delivery-agent accounts require a one-time code issued by a Minuto administrator.</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          title={busy ? "Saving…" : "Continue"}
          disabled={busy}
          onPress={() => {
            setBusy(true);
            void onDone(name, role, inviteCode).catch((reason: unknown) => setError(messageFor(reason))).finally(() => setBusy(false));
          }}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function AppContent({ client, session }: { client: NonNullable<typeof supabaseClient>; session: Session }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isFinanceAdmin, setIsFinanceAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [profileLoadError, setProfileLoadError] = useState("");

  const loadProfile = useCallback(async () => {
    setProfileLoadError("");
    const { error: ensureProfileError } = await client.rpc("ensure_my_profile");
    if (ensureProfileError) {
      console.warn("Profile repair was unavailable; continuing with the profile lookup.", ensureProfileError);
    }
    const [profileResult, adminResult] = await Promise.all([
      client.from("profiles")
        .select("id, display_name, email, role, marketplace_approval_status, marketplace_approval_note, pickup_address, seller_upi_id, seller_phone")
        .eq("id", session.user.id)
        .maybeSingle(),
      client.rpc("is_finance_admin"),
    ]);
    let loadedProfile: Profile | null = profileResult.data as Profile | null;
    if (profileResult.error) {
      const fallbackResult = await client.from("profiles")
        .select("id, display_name, email, role, pickup_address")
        .eq("id", session.user.id)
        .maybeSingle();
      if (fallbackResult.error) throw profileResult.error;
      if (fallbackResult.data) {
        loadedProfile = {
          ...(fallbackResult.data as Profile),
          marketplace_approval_status: "approved",
          marketplace_approval_note: null,
          seller_upi_id: null,
          seller_phone: null,
        };
      }
    }
    if (!loadedProfile) throw new Error("Your Auth account exists, but its profile row is missing. Run mobile/supabase/migrations/20261022_profile_recovery.sql in Supabase SQL Editor, then retry.");
    setProfile(loadedProfile);
    if (adminResult.error) {
      console.warn("Finance-admin check unavailable; continuing as a regular user.", adminResult.error);
    }
    setIsFinanceAdmin(adminResult.data === true);
    setLoading(false);
  }, [client, session.user.id]);

  useEffect(() => {
    let active = true;
    async function loadAccount() {
      try {
        await loadProfile();
      } catch (error: unknown) {
        if (active) {
          setProfileLoadError(messageFor(error));
          setLoading(false);
        }
      }
    }
    void loadAccount();
    return () => { active = false; };
  }, [loadProfile]);

  async function saveRole(name: string, role: Role, inviteCode: string) {
    const normalizedName = name.trim();
    if (normalizedName.length < 2 || normalizedName.length > 60) throw new Error("Enter a name between 2 and 60 characters.");
    const { error } = await client.rpc("choose_market_role", { p_role: role, p_display_name: normalizedName, p_invite_code: inviteCode });
    if (error) throw error;
    setProfile((current) => current ? {
      ...current,
      display_name: normalizedName,
      role,
      marketplace_approval_status: role === "buyer" ? "approved" : "pending",
    } : null);
  }

  async function saveVendorPaymentDetails(upiId: string, phone: string) {
    const { upiId: normalizedUpiId, phone: normalizedPhone } = validateSellerPaymentDetails(upiId, phone);
    const { error } = await client.rpc("save_vendor_payment_details", {
      p_upi_id: normalizedUpiId,
      p_phone: normalizedPhone,
    });
    if (error) throw error;
    setProfile((current) => current
      ? { ...current, seller_upi_id: normalizedUpiId, seller_phone: normalizedPhone }
      : null);
  }

  if (loading) return <LoadingScreen label="Loading your account…" />;
  if (isFinanceAdmin) {
    return <FinanceAdminScreen client={client} onSignOut={async () => {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    }} />;
  }
  if (!profile) {
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar style="dark" />
        <View style={styles.center}>
          <Text style={styles.brand}>minuto</Text>
          <Text style={styles.heading}>You’re signed in.</Text>
          <Text style={styles.paragraph}>We couldn’t load your Minuto account details yet.</Text>
          <Text accessibilityRole="alert" style={styles.error}>{profileLoadError || "Your account profile is unavailable."}</Text>
          <Button title="Retry account setup" onPress={() => {
            setLoading(true);
            void loadProfile().catch((error: unknown) => {
              setProfileLoadError(messageFor(error));
              setLoading(false);
            });
          }} />
          <Button title="Sign out" secondary onPress={() => {
            void client.auth.signOut().catch((error: unknown) => setProfileLoadError(messageFor(error)));
          }} />
        </View>
      </SafeAreaView>
    );
  }
  if (profile.role === null) return <RoleScreen profile={profile} onDone={saveRole} />;
  const activeProfile = { ...profile, role: profile.role };
  if (profile.role === "vendor" && (!profile.seller_upi_id || !profile.seller_phone)) {
    return <VendorPaymentSetupScreen onSave={saveVendorPaymentDetails} />;
  }
  if (profile.marketplace_approval_status !== "approved") {
    return <ApprovalStatusScreen
      client={client}
      profile={activeProfile}
      onSaveVendorPaymentDetails={saveVendorPaymentDetails}
      onRefresh={loadProfile}
      onRequestReview={async () => {
        const { error } = await client.rpc("request_marketplace_review");
        if (error) throw error;
        setProfile((current) => current ? { ...current, marketplace_approval_status: "pending", marketplace_approval_note: null } : null);
      }}
    />;
  }
  return <Marketplace
    client={client}
    profile={activeProfile}
    notice={notice}
    setNotice={setNotice}
    onSaveVendorPaymentDetails={saveVendorPaymentDetails}
  />;
}

function ApprovalStatusScreen({
  client,
  profile,
  onSaveVendorPaymentDetails,
  onRefresh,
  onRequestReview,
}: {
  client: NonNullable<typeof supabaseClient>;
  profile: ActiveProfile;
  onSaveVendorPaymentDetails: (upiId: string, phone: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onRequestReview: () => Promise<void>;
}) {
  const [upiId, setUpiId] = useState(profile.seller_upi_id ?? "");
  const [phone, setPhone] = useState(profile.seller_phone ?? "");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const rejected = profile.marketplace_approval_status === "rejected";

  function run(action: () => Promise<void>) {
    setBusy(true);
    void action()
      .then(() => setNotice(""))
      .catch((error: unknown) => setNotice(messageFor(error)))
      .finally(() => setBusy(false));
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>minuto</Text>
        <Text style={styles.heading}>{rejected ? "More information needed" : "Account under review"}</Text>
        <Text style={styles.paragraph}>
          {rejected
            ? "Your account is not active yet. Review the note below, update your details if needed, then request another review."
            : "A Minuto administrator must approve this account before vendor listings or delivery jobs become available."}
        </Text>
        {profile.marketplace_approval_note
          ? <Text style={styles.noticeText}>Review note: {profile.marketplace_approval_note}</Text>
          : null}
        {profile.role === "vendor" ? <>
          <Text style={styles.note}>Seller UPI details are private to finance administrators and are not independently verified by the app.</Text>
          <Field label="Your UPI ID" value={upiId} onChangeText={setUpiId} placeholder="name@bank" keyboard="email-address" />
          <Field label="Mobile number" value={phone} onChangeText={setPhone} placeholder="10-digit number" keyboard="phone-pad" />
          <Button title={busy ? "Saving…" : "Save seller payment details"} secondary disabled={busy} onPress={() => run(async () => {
            await onSaveVendorPaymentDetails(upiId, phone);
          })} />
        </> : null}
        {notice ? <Text accessibilityRole="alert" style={styles.error}>{notice}</Text> : null}
        {rejected
          ? <Button title={busy ? "Requesting…" : "Request another review"} disabled={busy} onPress={() => run(onRequestReview)} />
          : <Button title={busy ? "Checking…" : "Refresh approval status"} disabled={busy} onPress={() => run(onRefresh)} />}
        <Button title="Sign out" secondary disabled={busy} onPress={() => run(async () => {
          const { error } = await client.auth.signOut();
          if (error) throw error;
        })} />
      </ScrollView>
    </SafeAreaView>
  );
}

function FinanceAdminScreen({
  client,
  onSignOut,
}: {
  client: NonNullable<typeof supabaseClient>;
  onSignOut: () => Promise<void>;
}) {
  const [fontsLoaded, fontsError] = useFonts({
    PlayfairDisplay_400Regular,
    PlayfairDisplay_500Medium,
    PlayfairDisplay_600SemiBold,
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });
  const [applicants, setApplicants] = useState<PendingApplicant[]>([]);
  const [managedAccounts, setManagedAccounts] = useState<ManagedAccount[]>([]);
  const [payouts, setPayouts] = useState<FinancePayout[]>([]);
  const [cases, setCases] = useState<ReconciliationCase[]>([]);
  const [auditEntries, setAuditEntries] = useState<FinanceAuditEntry[]>([]);
  const [serviceProviders, setServiceProviders] = useState<AdminServiceProvider[]>([]);
  const [providerCategory, setProviderCategory] = useState<EverydayService["category"]>("grooming");
  const [providerName, setProviderName] = useState("");
  const [providerDescription, setProviderDescription] = useState("");
  const [providerArea, setProviderArea] = useState("");
  const [providerPrice, setProviderPrice] = useState("");
  const [providerVerified, setProviderVerified] = useState(true);
  const [providerActive, setProviderActive] = useState(true);
  const [serviceBookings, setServiceBookings] = useState<AdminServiceBooking[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [transferReferences, setTransferReferences] = useState<Record<string, string>>({});
  const [refundNotes, setRefundNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [accountNotes, setAccountNotes] = useState<Record<string, string>>({});
  const [inviteRole, setInviteRole] = useState<"vendor" | "agent">("vendor");
  const [generatedInviteCode, setGeneratedInviteCode] = useState("");
  const [copiedInviteCode, setCopiedInviteCode] = useState(false);
  const [adminSection, setAdminSection] = useState<"overview" | "trust" | "finance" | "services" | "activity">("overview");

  const refresh = useCallback(async () => {
    const [applicantResult, accountResult, payoutResult, caseResult, auditResult, providerResult, bookingResult] = await Promise.all([
      client.from("profiles")
        .select("id,display_name,email,role,marketplace_approval_status,marketplace_approval_note,seller_upi_id,seller_phone,created_at")
        .eq("marketplace_approval_status", "pending")
        .in("role", ["vendor", "agent"])
        .order("created_at", { ascending: true })
        .limit(100),
      client.from("profiles")
        .select("id,display_name,email,role,marketplace_approval_status,marketplace_approval_note,seller_upi_id,seller_phone,created_at")
        .in("role", ["vendor", "agent"])
        .order("created_at", { ascending: false })
        .limit(200),
      client.from("seller_payouts")
        .select("id,order_id,vendor_id,gross_amount,delivery_contribution,amount,status,transfer_reference,created_at,seller_upi_id,seller_phone")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(100),
      client.from("payment_reconciliation_cases")
        .select("payment_id,order_id,amount_paise,reason,status,created_at")
        .eq("status", "open")
        .order("created_at", { ascending: true })
        .limit(100),
      client.from("finance_admin_audit_log")
        .select("id,action,entity_id,created_at")
        .order("created_at", { ascending: false })
        .limit(25),
      client.from("service_providers")
        .select("id,category,name,description,service_area,starting_price,verified,active")
        .order("created_at", { ascending: false })
        .limit(100),
      client.from("service_bookings")
        .select("id,category,requested_for,address,notes,status,buyer_id,provider_id,service_providers(name)")
        .in("status", ["requested", "confirmed", "in_progress"])
        .order("created_at", { ascending: true })
        .limit(100),
    ]);
    const firstError = applicantResult.error ?? accountResult.error ?? payoutResult.error ?? caseResult.error ?? auditResult.error ?? providerResult.error ?? bookingResult.error;
    if (firstError) throw firstError;
    setApplicants((applicantResult.data ?? []) as PendingApplicant[]);
    setManagedAccounts((accountResult.data ?? []) as ManagedAccount[]);
    setPayouts((payoutResult.data ?? []) as FinancePayout[]);
    setCases((caseResult.data ?? []) as ReconciliationCase[]);
    setAuditEntries((auditResult.data ?? []) as FinanceAuditEntry[]);
    setServiceProviders((providerResult.data ?? []) as AdminServiceProvider[]);
    setServiceBookings((bookingResult.data ?? []) as AdminServiceBooking[]);
  }, [client]);

  useEffect(() => {
    let active = true;
    async function loadFinanceRecords() {
      try {
        await refresh();
      } catch (error: unknown) {
        if (active) setNotice(`Could not load finance records: ${messageFor(error)}`);
      }
    }
    void loadFinanceRecords();
    const channel = client.channel("finance-admin-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        void refresh().catch((error: unknown) => setNotice(`Could not refresh account reviews: ${messageFor(error)}`));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "seller_payouts" }, () => {
        void refresh().catch((error: unknown) => setNotice(`Could not refresh seller payouts: ${messageFor(error)}`));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_reconciliation_cases" }, () => {
        void refresh().catch((error: unknown) => setNotice(`Could not refresh payment reviews: ${messageFor(error)}`));
      })
      .subscribe();
    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [client, refresh]);

  function run(action: () => Promise<void>) {
    setBusy(true);
    void action()
      .then(refresh)
      .then(() => setNotice(""))
      .catch((error: unknown) => setNotice(messageFor(error)))
      .finally(() => setBusy(false));
  }

  function runAccountStatus(account: ManagedAccount, status: "approved" | "suspended" | "banned") {
    const note = (accountNotes[account.id] ?? "").trim();
    if (note.length < 10 || note.length > 500) {
      setNotice("Add a clear reason between 10 and 500 characters before changing this account.");
      return;
    }
    run(async () => {
      const { error } = await client.rpc("update_marketplace_account_status", {
        p_user_id: account.id,
        p_status: status,
        p_note: note,
      });
      if (error) throw error;
      setAccountNotes((current) => ({ ...current, [account.id]: "" }));
    });
  }

  function runApplicantReview(applicant: PendingApplicant, decision: "approved" | "rejected") {
    const note = (reviewNotes[applicant.id] ?? "").trim();
    if (note.length < 10 || note.length > 500) {
      setNotice("Add verification notes between 10 and 500 characters before reviewing this account.");
      return;
    }

    run(async () => {
      const { error } = await client.rpc("review_marketplace_account", {
        p_user_id: applicant.id,
        p_decision: decision,
        p_note: note,
      });
      if (error) throw error;
      setReviewNotes((current) => ({ ...current, [applicant.id]: "" }));
    });
  }

  async function copyInviteCode() {
    if (!generatedInviteCode) return;
    await Clipboard.setStringAsync(generatedInviteCode);
    setCopiedInviteCode(true);
    setNotice("Invite code copied to your clipboard.");
  }

  const pendingPayoutTotal = payouts.reduce((total, payout) => total + payout.amount, 0);
  const paymentExceptionTotal = cases.reduce((total, paymentCase) => total + paymentCase.amount_paise / 100, 0);
  const [auditFilter, setAuditFilter] = useState<AuditFilter>("all");
  const auditSummary = useMemo(() => {
    const counts = { trust: 0, finance: 0, services: 0 };
    auditEntries.forEach((entry) => {
      counts[auditMeta(entry.action).filter] += 1;
    });
    const filtered = auditFilter === "all"
      ? auditEntries
      : auditEntries.filter((entry) => auditMeta(entry.action).filter === auditFilter);
    return { counts, filtered };
  }, [auditEntries, auditFilter]);

  if (!fontsLoaded && !fontsError) {
    return <LoadingScreen label="Preparing admin workspace…" />;
  }

  function recordPayout(payout: FinancePayout) {
    const reference = (transferReferences[payout.id] ?? "").trim();
    if (reference.length < 4 || reference.length > 120) {
      setNotice("Enter the completed transfer reference before recording this payout.");
      return;
    }
    run(async () => {
      const { error } = await client.rpc("record_seller_payout", {
        p_payout_id: payout.id,
        p_transfer_reference: reference,
      });
      if (error) throw error;
      setTransferReferences((current) => ({ ...current, [payout.id]: "" }));
    });
  }

  function recordRefund(paymentCase: ReconciliationCase) {
    const note = (refundNotes[paymentCase.payment_id] ?? "").trim();
    if (note.length < 10 || note.length > 500) {
      setNotice("Enter the completed refund reference and note between 10 and 500 characters.");
      return;
    }
    run(async () => {
      const { error } = await client.rpc("resolve_payment_reconciliation", {
        p_payment_id: paymentCase.payment_id,
        p_resolution_status: "refunded",
        p_resolution_note: note,
      });
      if (error) throw error;
      setRefundNotes((current) => ({ ...current, [paymentCase.payment_id]: "" }));
    });
  }

  return (
    <SafeAreaView style={[styles.safe, styles.adminSafe]}>
      <StatusBar style="dark" />
      <View style={[styles.topBar, styles.adminTopBar]}>
        <View><Text style={styles.brand}>minuto</Text><Text style={styles.note}>Admin workspace · Nagpur</Text></View>
        <View style={styles.adminTopActions}><View style={styles.adminProfilePill}><Text style={styles.adminProfileText}>ADMIN</Text></View><Pressable onPress={() => run(onSignOut)}><Text style={styles.link}>Sign out</Text></Pressable></View>
      </View>
      {notice ? <Pressable accessibilityRole="alert" onPress={() => setNotice("")} style={styles.notice}><Text style={styles.paragraph}>{notice}</Text></Pressable> : null}
      <ScrollView contentContainerStyle={[styles.content, styles.adminContent]} keyboardShouldPersistTaps="handled">
        <ImageBackground
          source={{ uri: "https://images.unsplash.com/photo-1500534623283-312aade485b7?auto=format&fit=crop&w=1600&q=80" }}
          imageStyle={styles.adminHeroImage}
          style={styles.adminHero}
        >
          <View style={styles.adminHeroShade} />
          <View style={styles.adminHeroContent}>
            <View style={styles.adminHeroTop}><Text style={[styles.serviceEyebrow, styles.adminEyebrow]}>MINUTO CONTROL CENTER</Text><Text style={styles.adminLive}>● LIVE</Text></View>
            <Text style={styles.adminHeroTitle}>The operations desk{`\n`}for a marketplace that moves fast.</Text>
            <Text style={styles.adminHeroText}>Review people, protect buyer trust, and keep every local service moving with clarity.</Text>
          </View>
        </ImageBackground>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.adminNav}>
          {([
            ["overview", "Overview"],
            ["trust", "People & trust"],
            ["finance", "Finance"],
            ["services", "Services"],
            ["activity", "Audit trail"],
          ] as const).map(([value, label]) => <Pressable key={value} onPress={() => setAdminSection(value)} style={[styles.adminNavItem, adminSection === value && styles.adminNavItemActive]}><Text style={[styles.adminNavText, adminSection === value && styles.adminNavTextActive]}>{label}</Text></Pressable>)}
        </ScrollView>
        {adminSection === "overview" ? <View style={styles.adminWelcome}>
          <View style={styles.adminQuickGrid}>
            <Pressable style={styles.adminQuickCard} onPress={() => setAdminSection("trust")}><View style={styles.adminQuickTop}><Text style={styles.adminQuickIcon}>✓</Text><Text style={styles.adminQuickArrow}>↗</Text></View><Text style={styles.cardTitle}>Review accounts</Text><Text style={styles.note}>Approve, suspend, or ban</Text></Pressable>
            <Pressable style={styles.adminQuickCard} onPress={() => setAdminSection("services")}><View style={styles.adminQuickTop}><Text style={styles.adminQuickIcon}>+</Text><Text style={styles.adminQuickArrow}>↗</Text></View><Text style={styles.cardTitle}>Add a provider</Text><Text style={styles.note}>Publish trusted services</Text></Pressable>
            <Pressable style={styles.adminQuickCard} onPress={() => setAdminSection("finance")}><View style={styles.adminQuickTop}><Text style={styles.adminQuickIcon}>₹</Text><Text style={styles.adminQuickArrow}>↗</Text></View><Text style={styles.cardTitle}>Resolve finance</Text><Text style={styles.note}>Payouts and exceptions</Text></Pressable>
            <Pressable style={styles.adminQuickCard} onPress={() => setAdminSection("activity")}><View style={styles.adminQuickTop}><Text style={styles.adminQuickIcon}>↗</Text><Text style={styles.adminQuickArrow}>↗</Text></View><Text style={styles.cardTitle}>View audit trail</Text><Text style={styles.note}>See recent decisions</Text></Pressable>
          </View>
        </View> : null}

        {adminSection === "trust" ? <>
        <Text style={styles.heading}>People & trust</Text>
        <View style={styles.trustSummary}><Text style={styles.serviceEyebrow}>ACCESS CONTROL</Text><Text style={styles.cardTitle}>{managedAccounts.length ? `${managedAccounts.length} marketplace account${managedAccounts.length === 1 ? "" : "s"}` : "No marketplace accounts yet"}</Text><Text style={styles.note}>Approve trusted operators or restrict access when needed.</Text></View>
        {managedAccounts.map((account) => <View key={account.id} style={styles.jobCard}>
          <Text style={styles.cardTitle}>{account.display_name} · {labelForRole[account.role]}</Text>
          <Text style={styles.note}>{account.email} · Status: {account.marketplace_approval_status}</Text>
          {account.marketplace_approval_note ? <Text style={styles.note}>Previous note: {account.marketplace_approval_note}</Text> : null}
          <Field label="Reason (10–500 characters)" value={accountNotes[account.id] ?? ""} onChangeText={(value) => setAccountNotes((current) => ({ ...current, [account.id]: value }))} placeholder="Food-safety inspection, identity review, or trust decision" multiline />
          <View style={styles.adminActions}>
            {account.marketplace_approval_status !== "approved" ? <Button title="Approve / reinstate" disabled={busy} onPress={() => runAccountStatus(account, "approved")} /> : null}
            {account.marketplace_approval_status !== "suspended" ? <Button title="Suspend" secondary disabled={busy} onPress={() => runAccountStatus(account, "suspended")} /> : null}
            {account.marketplace_approval_status !== "banned" ? <Button title="Permanently ban" secondary disabled={busy} onPress={() => runAccountStatus(account, "banned")} /> : null}
          </View>
        </View>)}

        <Text style={styles.heading}>Invite a trusted operator</Text>
        <Text style={styles.note}>Create a one-time code for a verified seller or delivery agent.</Text>
        <View style={styles.chips}>
          {(["vendor", "agent"] as const).map((role) => <Pressable key={role} onPress={() => setInviteRole(role)} style={[styles.chip, inviteRole === role && styles.chipSelected]}><Text>{labelForRole[role]}</Text></Pressable>)}
        </View>
        <Button title={busy ? "Generating…" : `Generate ${labelForRole[inviteRole]} code`} disabled={busy} onPress={() => run(async () => {
          const { data, error } = await client.rpc("create_admin_invite_code", { p_role: inviteRole });
          if (error) throw error;
          setGeneratedInviteCode(String(data));
        })} />
        {generatedInviteCode ? <View style={styles.inviteCodeCard}><Text style={styles.serviceEyebrow}>ONE-TIME CODE</Text><Text selectable style={styles.inviteCode}>{generatedInviteCode}</Text><Button title={copiedInviteCode ? "Copied" : "Copy code"} secondary disabled={copiedInviteCode} onPress={() => void copyInviteCode()} /></View> : null}

        <Text style={styles.heading}>Pending approvals</Text>
        {applicants.length === 0 ? <View style={styles.emptyState}><Text style={styles.cardTitle}>You’re all caught up</Text><Text style={styles.note}>New seller and agent applications will appear here.</Text></View> : null}
        {applicants.map((applicant) => <View key={applicant.id} style={styles.jobCard}>
          <Text style={styles.cardTitle}>{applicant.display_name} · {labelForRole[applicant.role]}</Text>
          <Text style={styles.note}>{applicant.email}</Text>
          {applicant.role === "vendor" ? <>
            <Text style={styles.note}>UPI ID: {applicant.seller_upi_id ?? "Not provided"}</Text>
            <Text style={styles.note}>Phone: {applicant.seller_phone ?? "Not provided"}</Text>
          </> : null}
          <Field
            label="Verification notes (10–500 characters)"
            value={reviewNotes[applicant.id] ?? ""}
            onChangeText={(value) => setReviewNotes((current) => ({ ...current, [applicant.id]: value }))}
            placeholder="Record identity, contact, and seller UPI verification"
            multiline
          />
          <Button title={busy ? "Saving…" : "Approve account"} disabled={busy} onPress={() => runApplicantReview(applicant, "approved")} />
          <Button title={busy ? "Saving…" : "Reject account"} secondary disabled={busy} onPress={() => runApplicantReview(applicant, "rejected")} />
        </View>)}
        </> : null}

        {adminSection === "finance" ? <>
        <View style={styles.financeSummary}>
          <View style={styles.financeSummaryTop}><Text style={styles.serviceEyebrow}>FINANCE DESK</Text><Text style={styles.financeStatus}>{payouts.length || cases.length ? "ACTION NEEDED" : "CLEAR"}</Text></View>
          <Text style={styles.financeTitle}>Money that needs your attention.</Text>
          <Text style={styles.note}>Review only completed transfers and refunds. Every action is recorded.</Text>
          <View style={styles.financeMetrics}>
            <View><Text style={styles.financeMetricValue}>{formatMoney(pendingPayoutTotal)}</Text><Text style={styles.financeMetricLabel}>Pending payouts</Text></View>
            <View><Text style={styles.financeMetricValue}>{formatMoney(paymentExceptionTotal)}</Text><Text style={styles.financeMetricLabel}>Payment exceptions</Text></View>
          </View>
        </View>
        <Text style={styles.heading}>Seller payouts <Text style={styles.financeCount}>{payouts.length}</Text></Text>
        {payouts.length === 0 ? <View style={styles.emptyState}><Text style={styles.cardTitle}>No payouts waiting</Text><Text style={styles.note}>Completed seller transfers will appear here.</Text></View> : null}
        {payouts.map((payout) => <View key={payout.id} style={styles.jobCard}>
          <View style={styles.financeRow}><Text style={styles.cardTitle}>{formatMoney(payout.amount)}</Text><Text style={styles.financeBadge}>PENDING</Text></View>
          <Text style={styles.note}>Seller payout · order {payout.order_id}</Text>
          <Text style={styles.note}>Pay to {payout.seller_upi_id} · {payout.seller_phone}</Text>
          <Field
            label="Completed bank transfer reference"
            value={transferReferences[payout.id] ?? ""}
            onChangeText={(value) => setTransferReferences((current) => ({ ...current, [payout.id]: value }))}
            placeholder="Bank / UPI transaction reference"
          />
          <Button title={busy ? "Recording…" : "Record completed transfer"} disabled={busy} onPress={() => recordPayout(payout)} />
        </View>)}

        <Text style={styles.heading}>Payment exceptions <Text style={styles.financeCount}>{cases.length}</Text></Text>
        {cases.length === 0 ? <View style={styles.emptyState}><Text style={styles.cardTitle}>No payment exceptions</Text><Text style={styles.note}>Captured payments requiring review will appear here.</Text></View> : null}
        {cases.map((paymentCase) => <View key={paymentCase.payment_id} style={styles.jobCard}>
          <View style={styles.financeRow}><Text style={styles.cardTitle}>Order {paymentCase.order_id}</Text><Text style={styles.financeBadgeDanger}>REVIEW</Text></View>
          <Text style={styles.note}>Payment {paymentCase.payment_id} · {formatMoney(paymentCase.amount_paise / 100)}</Text>
          <Text style={styles.paragraph}>{paymentCase.reason}</Text>
          <Field
            label="Completed refund reference and note"
            value={refundNotes[paymentCase.payment_id] ?? ""}
            onChangeText={(value) => setRefundNotes((current) => ({ ...current, [paymentCase.payment_id]: value }))}
            placeholder="Refund transaction reference and outcome"
            multiline
          />
          <Button title={busy ? "Recording…" : "Record completed refund"} disabled={busy} onPress={() => recordRefund(paymentCase)} />
        </View>)}
        </> : null}

        {adminSection === "services" ? <>
        <View style={styles.servicesSummary}><View style={styles.financeSummaryTop}><Text style={styles.serviceEyebrow}>SERVICES STUDIO</Text><Text style={styles.financeStatus}>{serviceBookings.length ? "LIVE REQUESTS" : "READY"}</Text></View><Text style={styles.financeTitle}>Trusted help, well maintained.</Text><Text style={styles.note}>Publish providers and keep appointments moving.</Text><View style={styles.servicesMetrics}><View><Text style={styles.financeMetricValue}>{serviceProviders.length}</Text><Text style={styles.financeMetricLabel}>Providers</Text></View><View><Text style={styles.financeMetricValue}>{serviceBookings.length}</Text><Text style={styles.financeMetricLabel}>Open requests</Text></View></View></View>
        <View style={styles.providerBrief}>
          <View style={styles.providerBriefHeader}><View><Text style={styles.providerBriefKicker}>NEW PROVIDER</Text><Text style={styles.providerBriefTitle}>Create a service brief</Text></View><Text style={styles.providerBriefMark}>✦</Text></View>
          <Text style={styles.providerBriefText}>Shape the listing buyers will trust. Keep the details precise and easy to act on.</Text>
          <Text style={styles.providerBriefLabel}>SERVICE TYPE</Text>
          <View style={styles.serviceTypeGrid}>{([
            ["grooming", "Grooming", "Barber & beauty"],
            ["vehicle", "Vehicle", "Mechanic & roadside"],
            ["home", "Home", "Repairs & care"],
            ["errands", "Errands", "Everyday assistance"],
          ] as const).map(([category, title, subtitle]) => <Pressable key={category} onPress={() => setProviderCategory(category)} style={[styles.serviceTypeCard, providerCategory === category && styles.serviceTypeCardSelected]}><Text style={[styles.serviceTypeIcon, providerCategory === category && styles.serviceTypeIconSelected]}>{category === "grooming" ? "✦" : category === "vehicle" ? "◌" : category === "home" ? "⌂" : "→"}</Text><Text style={styles.serviceTypeTitle}>{title}</Text><Text style={styles.serviceTypeSubtitle}>{subtitle}</Text></Pressable>)}</View>
          <Text style={styles.providerBriefLabel}>LISTING DETAILS</Text>
          <View style={styles.providerField}><Text style={styles.providerFieldLabel}>Provider or business name</Text><TextInput value={providerName} onChangeText={setProviderName} placeholder="Example Barber Studio" placeholderTextColor="#8B8A83" style={styles.providerInput} /></View>
          <View style={styles.providerField}><Text style={styles.providerFieldLabel}>What should buyers know?</Text><TextInput value={providerDescription} onChangeText={setProviderDescription} placeholder="A clear promise in one or two lines" placeholderTextColor="#8B8A83" multiline style={[styles.providerInput, styles.providerInputMultiline]} /></View>
          <View style={styles.providerSplit}><View style={styles.providerFieldHalf}><Text style={styles.providerFieldLabel}>Service area</Text><TextInput value={providerArea} onChangeText={setProviderArea} placeholder="Dharampeth" placeholderTextColor="#8B8A83" style={styles.providerInput} /></View><View style={styles.providerFieldHalf}><Text style={styles.providerFieldLabel}>Starting price (₹)</Text><TextInput value={providerPrice} onChangeText={setProviderPrice} placeholder="199" placeholderTextColor="#8B8A83" keyboardType="number-pad" style={styles.providerInput} /></View></View>
          <View style={styles.providerSettings}><Pressable onPress={() => setProviderVerified((current) => !current)} style={styles.providerSetting}><View><Text style={styles.providerSettingTitle}>Verified provider</Text><Text style={styles.providerSettingNote}>Show the trust mark</Text></View><Text style={styles.providerSettingValue}>{providerVerified ? "YES" : "NO"}</Text></Pressable><Pressable onPress={() => setProviderActive((current) => !current)} style={styles.providerSetting}><View><Text style={styles.providerSettingTitle}>Visibility</Text><Text style={styles.providerSettingNote}>Available to buyers now</Text></View><Text style={styles.providerSettingValue}>{providerActive ? "LIVE" : "DRAFT"}</Text></Pressable></View>
          <Pressable style={[styles.providerPublishButton, busy && styles.disabled]} disabled={busy} onPress={() => run(async () => {
            const price = Number(providerPrice);
            if (!providerName.trim() || !providerDescription.trim() || !providerArea.trim()) throw new Error("Complete the provider name, promise, and service area.");
            if (!Number.isInteger(price) || price < 0) throw new Error("Enter a valid whole-rupee starting price.");
            const { error } = await client.rpc("create_service_provider", { p_category: providerCategory, p_name: providerName, p_description: providerDescription, p_service_area: providerArea, p_starting_price: price, p_verified: providerVerified, p_active: providerActive });
            if (error) throw error;
            setProviderName(""); setProviderDescription(""); setProviderArea(""); setProviderPrice("");
          })}><Text style={styles.providerPublishText}>{busy ? "Saving provider…" : "Publish provider brief  →"}</Text></Pressable>
        </View>
        <Text style={styles.heading}>Provider record <Text style={styles.financeCount}>{serviceProviders.length}</Text></Text>
        {serviceProviders.length === 0 ? <View style={styles.emptyState}><Text style={styles.cardTitle}>No providers yet</Text><Text style={styles.note}>Published providers will be tracked here.</Text></View> : serviceProviders.map((provider) => <View key={provider.id} style={styles.providerAdminCard}><View style={styles.serviceCardTop}><Text style={styles.cardTitle}>{provider.name}</Text><Text style={provider.active ? styles.financeBadge : styles.financeBadgeDanger}>{provider.active ? "ACTIVE" : "DRAFT"}</Text></View><Text style={styles.note}>{provider.category} · {provider.service_area} · From {formatMoney(provider.starting_price)}</Text><Text style={styles.note}>{provider.verified ? "Verified provider" : "Verification required"}</Text></View>)}

        <Text style={styles.heading}>Open requests <Text style={styles.financeCount}>{serviceBookings.length}</Text></Text>
        {serviceBookings.length === 0 ? <View style={styles.emptyState}><Text style={styles.cardTitle}>No open requests</Text><Text style={styles.note}>New buyer bookings will appear here.</Text></View> : serviceBookings.map((booking) => <View key={booking.id} style={styles.providerAdminCard}>
          <View style={styles.serviceCardTop}><Text style={styles.cardTitle}>{booking.service_providers?.[0]?.name ?? "Provider"} · {booking.status.replaceAll("_", " ")}</Text><Text style={styles.serviceMeta}>{booking.category}</Text></View>
          <Text style={styles.note}>{new Date(booking.requested_for).toLocaleString()}</Text>
          <Text style={styles.paragraph}>{booking.address}</Text>
          {booking.notes ? <Text style={styles.note}>Notes: {booking.notes}</Text> : null}
          <View style={styles.chips}>
            {booking.status === "requested" ? <Button title="Confirm" disabled={busy} onPress={() => run(async () => {
              const { error } = await client.rpc("update_service_booking_status", { p_booking_id: booking.id, p_status: "confirmed" });
              if (error) throw error;
            })} /> : null}
            {booking.status === "confirmed" ? <Button title="Start service" disabled={busy} onPress={() => run(async () => {
              const { error } = await client.rpc("update_service_booking_status", { p_booking_id: booking.id, p_status: "in_progress" });
              if (error) throw error;
            })} /> : null}
            {booking.status === "in_progress" ? <Button title="Complete" disabled={busy} onPress={() => run(async () => {
              const { error } = await client.rpc("update_service_booking_status", { p_booking_id: booking.id, p_status: "completed" });
              if (error) throw error;
            })} /> : null}
            <Button title="Cancel" secondary disabled={busy} onPress={() => run(async () => {
              const { error } = await client.rpc("update_service_booking_status", { p_booking_id: booking.id, p_status: "cancelled" });
              if (error) throw error;
            })} />
          </View>
        </View>)}
        </> : null}

        {adminSection === "activity" ? <>
        <View style={styles.auditSummary}>
          <View style={styles.auditSummaryTop}><Text style={styles.serviceEyebrow}>AUDIT TRAIL</Text><Text style={styles.auditLive}>● LIVE RECORD</Text></View>
          <Text style={styles.auditTitle}>Every decision, accounted for.</Text>
          <Text style={styles.auditIntro}>A clear record of access, money, and marketplace changes made by Minuto administrators.</Text>
          <View style={styles.auditMetrics}>
            <View><Text style={styles.auditMetricValue}>{auditEntries.length}</Text><Text style={styles.auditMetricLabel}>Recent events</Text></View>
            <View><Text style={styles.auditMetricValue}>{auditSummary.counts.trust}</Text><Text style={styles.auditMetricLabel}>Trust</Text></View>
            <View><Text style={styles.auditMetricValue}>{auditSummary.counts.finance}</Text><Text style={styles.auditMetricLabel}>Finance</Text></View>
            <View><Text style={styles.auditMetricValue}>{auditSummary.counts.services}</Text><Text style={styles.auditMetricLabel}>Services</Text></View>
          </View>
        </View>
        <View style={styles.auditFilterRow}>
          {([
            ["all", "All activity"],
            ["trust", "Trust"],
            ["finance", "Finance"],
            ["services", "Services"],
          ] as const).map(([value, label]) => <Pressable key={value} onPress={() => setAuditFilter(value)} style={[styles.auditFilter, auditFilter === value && styles.auditFilterActive]}><Text style={[styles.auditFilterText, auditFilter === value && styles.auditFilterTextActive]}>{label}</Text></Pressable>)}
        </View>
        {auditEntries.length === 0
          ? <View style={styles.auditEmpty}><Text style={styles.auditEmptyMark}>—</Text><Text style={styles.cardTitle}>No actions recorded yet</Text><Text style={styles.note}>Admin decisions will appear here as a permanent operational record.</Text></View>
          : auditSummary.filtered.length === 0
            ? <View style={styles.auditEmpty}><Text style={styles.auditEmptyMark}>◌</Text><Text style={styles.cardTitle}>No matching activity</Text><Text style={styles.note}>Choose another filter to view the rest of the administrator record.</Text></View>
            : <View style={styles.auditTimelineList}>{auditSummary.filtered.map((entry, index) => {
              const meta = auditMeta(entry.action);
              return <View key={entry.id} style={styles.auditEvent}>
                <View style={styles.auditRail}><View style={[styles.auditDot, { backgroundColor: meta.color }]} />{index < auditSummary.filtered.length - 1 ? <View style={styles.auditLine} /> : null}</View>
                <View style={styles.auditEventBody}>
                  <View style={styles.auditEventTop}><Text style={[styles.auditGroup, { color: meta.color }]}>{meta.group}</Text><Text style={styles.auditTime}>{formatAuditDate(entry.created_at)}</Text></View>
                  <Text style={styles.auditEventTitle}>{meta.label}</Text>
                  <Text style={styles.auditEventDetail}>{meta.detail}</Text>
                  <View style={styles.auditReference}><Text style={styles.auditReferenceLabel}>REFERENCE</Text><Text selectable style={styles.auditReferenceValue}>{entry.entity_id}</Text><Text style={styles.auditEventIcon}>{meta.icon}</Text></View>
                </View>
              </View>;
            })}</View>}
        </> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function LoadingScreen({ label }: { label: string }) {
  return <View style={styles.center}><ActivityIndicator color={palette.green} /><Text style={styles.paragraph}>{label}</Text></View>;
}

function directionsUrl(destination: string) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

function RouteMapCard({
  pickup,
  destination,
  pickupCoordinate,
  destinationCoordinate,
  agentCoordinate,
  status,
  onOpenDirections,
}: {
  pickup: string;
  destination: string;
  pickupCoordinate?: [number, number];
  destinationCoordinate?: [number, number];
  agentCoordinate?: [number, number];
  status: string;
  onOpenDirections: () => void;
}) {
  const pickedUp = status === "picked_up" || status === "delivered";
  return (
    <View style={styles.routeMapCard}>
      <View style={styles.routeMapHeader}><View><Text style={styles.serviceEyebrow}>ROUTE MAP</Text><Text style={styles.routeMapTitle}>{pickedUp ? "Buyer route ready" : "Pickup route ready"}</Text></View><Text style={styles.routeMapCompass}>N</Text></View>
      <RouteMap pickup={pickup} destination={destination} pickupCoordinate={pickupCoordinate} destinationCoordinate={destinationCoordinate} agentCoordinate={agentCoordinate} />
      <View style={styles.routeMapAddresses}><View style={styles.routeMapAddressRow}><View style={[styles.routeMapDot, styles.routeMapDotPickup]} /><View style={styles.grow}><Text style={styles.routeMapLabel}>PICKUP</Text><Text numberOfLines={1} style={styles.routeMapAddress}>{pickup}</Text></View></View><View style={styles.routeMapAddressRow}><View style={[styles.routeMapDot, styles.routeMapDotDropoff]} /><View style={styles.grow}><Text style={styles.routeMapLabel}>DROP-OFF</Text><Text numberOfLines={1} style={styles.routeMapAddress}>{destination}</Text></View></View></View>
      <Button title={pickedUp ? "Open buyer directions →" : "Open pickup directions →"} secondary onPress={onOpenDirections} />
    </View>
  );
}

type PreviewDelivery = {
  id: string;
  vendor: string;
  pickup: string;
  buyer: string;
  destination: string;
  area: string;
  payout: number;
  status: "offered" | "accepted" | "picked_up" | "delivered";
};

function DeliveryAgentPreviewScreen() {
  const [jobs, setJobs] = useState<PreviewDelivery[]>([
    { id: "preview-1", vendor: "Dharampeth Fresh Mart", pickup: "12 Central Avenue, Dharampeth", buyer: "Aarav Mehta", destination: "18 Ravi Nagar Road", area: "Ravi Nagar", payout: 48, status: "offered" },
    { id: "preview-2", vendor: "Sonal Barber Studio", pickup: "West High Court Road", buyer: "Ishita Joshi", destination: "6 Laxmi Nagar", area: "Laxmi Nagar", payout: 62, status: "accepted" },
    { id: "preview-3", vendor: "Nagpur Home Essentials", pickup: "Wardha Road Market", buyer: "Kabir Shah", destination: "44 Manish Nagar", area: "Manish Nagar", payout: 55, status: "picked_up" },
  ]);
  const [agentTab, setAgentTab] = useState<"home" | "jobs" | "earnings">("home");
  const actionLock = useRef<Record<string, boolean>>({});

  async function advanceJob(job: PreviewDelivery) {
    if (actionLock.current[job.id]) return;
    actionLock.current[job.id] = true;
    const nextStatus: PreviewDelivery["status"] = job.status === "offered" ? "accepted" : job.status === "accepted" ? "picked_up" : "delivered";
    setJobs((current) => current.map((item) => item.id === job.id ? { ...item, status: nextStatus } : item));
    if (nextStatus === "picked_up") {
      const destination = `${job.destination}, ${job.area}, Nagpur`;
      const mapsUrl = directionsUrl(destination);
      try {
        await Linking.openURL(mapsUrl);
      } catch (error: unknown) {
        Alert.alert("Directions unavailable", messageFor(error));
      }
    }
    setTimeout(() => {
      delete actionLock.current[job.id];
    }, 350);
  }

  const activeJobs = jobs.filter((job) => job.status !== "delivered");
  const deliveredJobs = jobs.filter((job) => job.status === "delivered");
  const earned = deliveredJobs.reduce((sum, job) => sum + job.payout, 0);
  const nextAction: Record<PreviewDelivery["status"], string> = {
    offered: "Accept delivery →",
    accepted: "Mark picked up →",
    picked_up: "Mark delivered →",
    delivered: "Delivered",
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.previewBanner}><Text style={styles.previewBannerText}>DEVELOPMENT PREVIEW · AUTH LOGIN TEMPORARILY OFF</Text></View>
      <View style={styles.topBar}><View><Text style={styles.brand}>minuto</Text><Text style={styles.note}>Nagpur · Delivery agent</Text></View><Text style={styles.previewMode}>AGENT MODE</Text></View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {agentTab === "home" ? <>
          <Text style={styles.kicker}>DELIVERY DESK · NAGPUR</Text>
          <Text style={styles.heading}>Move the city forward.</Text>
          <Text style={styles.paragraph}>A focused view of your next pickup, route, and earnings.</Text>
          <View style={styles.agentHero}><View style={styles.agentHeroTop}><Text style={styles.serviceEyebrow}>MINUTO AGENT DESK</Text><Text style={styles.sellerLive}>● ONLINE</Text></View><Text style={styles.agentHeroTitle}>Your next delivery,{`\n`}made clear.</Text><Text style={styles.agentHeroText}>Accept only what fits your route. Keep every handoff calm and accountable.</Text></View>
          <View style={styles.agentMetricGrid}><View style={styles.sellerMetric}><Text style={styles.sellerMetricValue}>{activeJobs.length}</Text><Text style={styles.sellerMetricLabel}>Active jobs</Text></View><View style={styles.sellerMetric}><Text style={styles.sellerMetricValue}>{formatMoney(earned)}</Text><Text style={styles.sellerMetricLabel}>Earned today</Text></View><View style={styles.sellerMetric}><Text style={styles.sellerMetricValue}>{deliveredJobs.length}</Text><Text style={styles.sellerMetricLabel}>Delivered</Text></View></View>
          <View style={styles.agentNextCard}><Text style={styles.serviceEyebrow}>NEXT IN LINE</Text>{activeJobs[0] ? <><Text style={styles.agentNextTitle}>{activeJobs[0].vendor}</Text><Text style={styles.note}>{activeJobs[0].status === "accepted" ? `Confirm pickup at ${activeJobs[0].pickup}` : `Collect from ${activeJobs[0].pickup}`}</Text><Text style={styles.agentRoute}>{activeJobs[0].status === "picked_up" ? `Deliver to ${activeJobs[0].destination}, ${activeJobs[0].area}` : `${activeJobs[0].area} · ${formatMoney(activeJobs[0].payout)} payout`}</Text><Button title={nextAction[activeJobs[0].status]} onPress={() => void advanceJob(activeJobs[0])} /></> : <><Text style={styles.cardTitle}>Your queue is clear</Text><Text style={styles.note}>New delivery offers will appear here.</Text></>}</View>
          {activeJobs[0] ? <RouteMapCard pickup={activeJobs[0].pickup} destination={`${activeJobs[0].destination}, ${activeJobs[0].area}, Nagpur`} status={activeJobs[0].status} onOpenDirections={() => void Linking.openURL(directionsUrl(activeJobs[0].status === "accepted" ? activeJobs[0].pickup : `${activeJobs[0].destination}, ${activeJobs[0].area}, Nagpur`))} /> : null}
          <Text style={styles.sectionTitle}>How the handoff works</Text><View style={styles.agentSteps}><Text style={styles.agentStep}>01  Accept a route that works for you</Text><Text style={styles.agentStep}>02  Collect from the verified local seller</Text><Text style={styles.agentStep}>03  Deliver safely and close the job</Text></View>
        </> : null}
        {agentTab === "jobs" ? <><Text style={styles.kicker}>DELIVERY QUEUE · LIVE</Text><Text style={styles.heading}>Your routes.</Text><Text style={styles.paragraph}>Accept a job, confirm pickup, then directions open automatically to the buyer.</Text>{jobs.map((job) => <View key={job.id} style={styles.agentJobCard}><View style={styles.sellerJobTop}><Text style={styles.sellerJobStatus}>{job.status.replaceAll("_", " ").toUpperCase()}</Text><Text style={styles.agentPayout}>{formatMoney(job.payout)}</Text></View><Text style={styles.cardTitle}>{job.vendor}</Text><Text style={styles.agentLocation}>PICKUP · {job.pickup}</Text><Text style={styles.agentLocation}>DROP-OFF · {job.destination}, {job.area}</Text><Text style={styles.note}>Buyer: {job.buyer}</Text>{job.status !== "delivered" ? <Button title={nextAction[job.status]} disabled={false} onPress={() => void advanceJob(job)} /> : <Text style={styles.sellerJobHint}>Delivery completed and payout recorded.</Text>}<RouteMapCard pickup={job.pickup} destination={`${job.destination}, ${job.area}, Nagpur`} status={job.status} onOpenDirections={() => void Linking.openURL(directionsUrl(job.status === "accepted" ? job.pickup : `${job.destination}, ${job.area}, Nagpur`))} /></View>)}</> : null}
        {agentTab === "earnings" ? <><Text style={styles.kicker}>EARNINGS · AGENT</Text><Text style={styles.heading}>Your work, accounted for.</Text><Text style={styles.paragraph}>A transparent record of the deliveries you complete.</Text><View style={styles.agentEarningsCard}><Text style={styles.serviceEyebrow}>TODAY’S EARNINGS</Text><Text style={styles.agentEarningsTotal}>{formatMoney(earned)}</Text><Text style={styles.note}>{deliveredJobs.length} completed deliveries</Text></View><Text style={styles.sectionTitle}>Completed deliveries</Text>{deliveredJobs.length ? deliveredJobs.map((job) => <View key={job.id} style={styles.agentEarningRow}><View style={styles.grow}><Text style={styles.cardTitle}>{job.vendor}</Text><Text style={styles.note}>{job.area} · {job.buyer}</Text></View><Text style={styles.agentPayout}>{formatMoney(job.payout)}</Text></View>) : <View style={styles.sellerEmpty}><Text style={styles.cardTitle}>No completed deliveries yet</Text><Text style={styles.note}>Finish a route to see the payout record here.</Text></View>}</> : null}
      </ScrollView>
      <View style={styles.agentBottomBar}>{[["home", "Desk"], ["jobs", "Routes"], ["earnings", "Earnings"]].map(([value, label]) => <Pressable key={value} onPress={() => setAgentTab(value as typeof agentTab)}><Text style={[styles.tab, agentTab === value && styles.tabActive]}>{label}</Text></Pressable>)}</View>
    </SafeAreaView>
  );
}

function VendorPaymentSetupScreen({ onSave }: { onSave: (upiId: string, phone: string) => Promise<void> }) {
  const [upiId, setUpiId] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  function save() {
    setBusy(true);
    void onSave(upiId, phone)
      .catch((error: unknown) => setNotice(messageFor(error)))
      .finally(() => setBusy(false));
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.authScroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.brand}>minuto</Text>
        <Text style={styles.heading}>Set up seller payments</Text>
        <Text style={styles.paragraph}>Add your UPI ID and mobile number before publishing listings. Check that the details belong to you.</Text>
        <Text style={styles.note}>Buyer UPI payments go to Minuto’s configured gateway account. Minuto pays sellers separately using these saved details; this setup does not route or automatically transfer payments to your UPI account. Details are not independently verified.</Text>
        {notice ? <Pressable accessibilityRole="alert" onPress={() => setNotice("")} style={styles.notice}><Text style={styles.paragraph}>{notice}</Text></Pressable> : null}
        <Field label="Your UPI ID" value={upiId} onChangeText={setUpiId} placeholder="name@bank" keyboard="email-address" />
        <Field label="Mobile number" value={phone} onChangeText={setPhone} placeholder="10-digit number" keyboard="phone-pad" />
        <Button title={busy ? "Saving…" : "Save seller payment details"} disabled={busy} onPress={save} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Marketplace({
  client,
  profile,
  notice,
  setNotice,
  onSaveVendorPaymentDetails,
}: {
  client: NonNullable<typeof supabaseClient>;
  profile: ActiveProfile;
  notice: string;
  setNotice: (message: string) => void;
  onSaveVendorPaymentDetails: (upiId: string, phone: string) => Promise<void>;
}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<DeliveryJob[]>([]);
  const [agentLocations, setAgentLocations] = useState<Record<string, AgentLocation>>({});
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [buyerOrders, setBuyerOrders] = useState<BuyerOrder[]>([]);
  const [sellerPayouts, setSellerPayouts] = useState<SellerPayout[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [cart, setCart] = useState<Cart>({});
  const [pendingPaymentOrderId, setPendingPaymentOrderId] = useState<string | null>(null);
  const [upiAvailable, setUpiAvailable] = useState(true);
  const [tab, setTab] = useState<"home" | "shop" | "services" | "cart" | "activity" | "deliveries" | "orders" | "products" | "jobs" | "dashboard">(
    profile.role === "vendor" ? "dashboard" : profile.role === "agent" ? "jobs" : "home",
  );
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [details, setDetails] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("10");
  const [category, setCategory] = useState("fresh");
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [area, setArea] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [vendorAddress, setVendorAddress] = useState(profile.pickup_address ?? "");
  const [sellerUpiId, setSellerUpiId] = useState(profile.seller_upi_id ?? "");
  const [sellerPhone, setSellerPhone] = useState(profile.seller_phone ?? "");
  const [productEdits, setProductEdits] = useState<Record<string, { price: string; stock: string }>>({});
  const [sellerOrderFilter, setSellerOrderFilter] = useState<SellerOrderFilter>("active");
  const [search, setSearch] = useState("");
  const [selectedService, setSelectedService] = useState<EverydayService | null>(null);
  const [serviceProviders, setServiceProviders] = useState<ServiceProvider[]>([]);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [serviceBookings, setServiceBookings] = useState<ServiceBooking[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ServiceProvider | null>(null);
  const [selectedBookingSlot, setSelectedBookingSlot] = useState<"today-evening" | "tomorrow-morning" | "tomorrow-evening" | null>(null);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [newAddressLabel, setNewAddressLabel] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newArea, setNewArea] = useState("");
  const [newPostalCode, setNewPostalCode] = useState("");
  const [reminders, setReminders] = useState<LifeReminder[]>([]);
  const [newReminder, setNewReminder] = useState("");
  const [reminderDueAt, setReminderDueAt] = useState<"today" | "week" | "month" | null>(null);
  const [reviewRatings, setReviewRatings] = useState<Record<string, number>>({});
  const [reviewTexts, setReviewTexts] = useState<Record<string, string>>({});
  const [proofJobId, setProofJobId] = useState<string | null>(null);
  const [proofOtp, setProofOtp] = useState("");
  const [proofNote, setProofNote] = useState("");
  const [proofPhoto, setProofPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [deliveryOtps, setDeliveryOtps] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const [productResult, jobResult, favoriteResult, notificationResult] = await Promise.all([
      client.from("products").select("*").eq("active", true).order("created_at", { ascending: false }),
      profile.role === "agent"
        ? client.from("delivery_jobs").select(deliveryJobSelect).in("status", ["offered", "accepted", "picked_up"]).order("created_at", { ascending: false })
        : profile.role === "vendor"
          ? client.from("delivery_jobs").select(deliveryJobSelect).eq("vendor_id", profile.id).order("created_at", { ascending: false })
          : client.from("delivery_jobs").select(deliveryJobSelect).eq("buyer_id", profile.id).order("created_at", { ascending: false }),
      profile.role === "buyer"
        ? client.from("favorites").select("product_id").eq("user_id", profile.id)
        : Promise.resolve({ data: [], error: null }),
      client.from("notifications").select("id,title,body,read_at,created_at").order("created_at", { ascending: false }).limit(8),
    ]);
    if (productResult.error) throw productResult.error;
    if (jobResult.error) throw jobResult.error;
    if (favoriteResult.error) throw favoriteResult.error;
    if (notificationResult.error) {
      console.warn("Delivery notifications are unavailable until the notifications migration is applied.", notificationResult.error);
      setNotifications([]);
    } else {
      setNotifications((notificationResult.data ?? []) as AppNotification[]);
    }
    let buyerOrderData: BuyerOrder[] = [];
    let sellerPayoutData: SellerPayout[] = [];
    if (profile.role === "buyer") {
      const paymentOrders = await client.from("orders")
        .select("id,total,payment_method,payment_status,payment_review_required,payment_utr,created_at")
        .eq("buyer_id", profile.id)
        .order("created_at", { ascending: false });
      if (paymentOrders.error) {
        const baseOrders = await client.from("orders")
          .select("id,total,created_at")
          .eq("buyer_id", profile.id)
          .order("created_at", { ascending: false });
        if (baseOrders.error) throw paymentOrders.error;
        setUpiAvailable(false);
        setNotice("COD is ready. Apply the UPI payment migration in Supabase to enable UPI checkout.");
        buyerOrderData = (baseOrders.data ?? []).map((order) => ({
          id: order.id,
          total: order.total,
          payment_method: "cod",
          payment_status: "not_required",
          payment_review_required: false,
          payment_utr: null,
          created_at: order.created_at,
        }));
      } else {
        setUpiAvailable(true);
        buyerOrderData = (paymentOrders.data ?? []) as BuyerOrder[];
      }
    } else if (profile.role === "vendor") {
      const { data, error } = await client.from("seller_payouts")
        .select("id,order_id,gross_amount,delivery_contribution,amount,status,transfer_reference,created_at")
        .eq("vendor_id", profile.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      sellerPayoutData = (data ?? []) as SellerPayout[];
    }
    setProducts((productResult.data ?? []) as Product[]);
    const deliveryJobs = (jobResult.data ?? []) as DeliveryJob[];
    setOrders(deliveryJobs);
    const agentIds = [...new Set(deliveryJobs.map((job) => job.agent_id).filter((id): id is string => Boolean(id)))];
    if (agentIds.length) {
      const locationResult = await client.from("delivery_agent_locations")
        .select("agent_id,latitude,longitude,updated_at")
        .in("agent_id", agentIds);
      if (locationResult.error) {
        console.warn("Live agent locations are unavailable until the delivery tracking migration is applied.", locationResult.error);
        setAgentLocations({});
      } else {
        setAgentLocations(Object.fromEntries(((locationResult.data ?? []) as AgentLocation[]).map((location) => [location.agent_id, location])));
      }
    } else {
      setAgentLocations({});
    }
    setFavorites((favoriteResult.data ?? []).map((favorite: { product_id: string }) => favorite.product_id));
    setBuyerOrders(buyerOrderData);
    setSellerPayouts(sellerPayoutData);
    if (profile.role === "buyer") {
      const [providerResult, addressResult, bookingResult, reminderResult] = await Promise.all([
        client.from("service_providers").select("id,category,name,description,service_area,starting_price,rating,review_count,verified").eq("active", true).order("verified", { ascending: false }),
        client.from("saved_addresses").select("id,label,address,area,postal_code").order("created_at", { ascending: false }),
        client.from("service_bookings").select("id,category,requested_for,address,status,service_providers(name),service_reviews(rating,review)").order("created_at", { ascending: false }),
        client.from("life_reminders").select("id,title,due_at,completed").order("completed", { ascending: true }).order("due_at", { ascending: true, nullsFirst: false }),
      ]);
      const serviceError = providerResult.error ?? addressResult.error ?? bookingResult.error ?? reminderResult.error;
      if (serviceError) {
        console.warn("Daily-life services are not available until their migration is applied.", serviceError);
        setServiceProviders([]);
        setSavedAddresses([]);
        setServiceBookings([]);
        setReminders([]);
        setNotice("Shopping is ready. Apply the daily-life services migration in Supabase to enable bookings and reminders.");
      } else {
        setServiceProviders((providerResult.data ?? []) as ServiceProvider[]);
        setSavedAddresses((addressResult.data ?? []) as SavedAddress[]);
        setServiceBookings((bookingResult.data ?? []) as ServiceBooking[]);
        setReminders((reminderResult.data ?? []) as LifeReminder[]);
      }
    }
  }, [client, profile.id, profile.role, setNotice]);

  useEffect(() => {
    if (profile.role !== "agent") return;
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;
    async function startLocationSharing() {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted || cancelled) {
        if (!cancelled) setNotice("Location sharing is off. Enable location permission to show your live delivery position.");
        return;
      }
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 50, timeInterval: 30000 },
        ({ coords }) => {
          void client.rpc("update_delivery_agent_location", {
            p_latitude: coords.latitude,
            p_longitude: coords.longitude,
            p_accuracy_meters: coords.accuracy,
            p_heading_degrees: coords.heading,
          }).then(({ error }) => {
            if (error) console.warn("Could not update delivery-agent location.", error);
          });
        },
      );
    }
    void startLocationSharing().catch((error: unknown) => setNotice(`Live location could not start: ${messageFor(error)}`));
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [client, profile.role, setNotice]);

  const syncUpiPayment = useCallback(async (orderId: string) => {
    const { data, error } = await client.functions.invoke<{
      status: string;
      reviewRequired?: boolean;
      message?: string;
    }>("sync-youpi-payment", { body: { orderId } });
    if (error) {
      if (error.context instanceof Response) {
        const responseBody: unknown = await error.context.clone().json().catch(() => null);
        if (typeof responseBody === "object" && responseBody !== null
          && "error" in responseBody && typeof responseBody.error === "string") {
          throw new Error(responseBody.error);
        }
      }
      throw error;
    }
    const statusNotice = data?.reviewRequired
      ? "Payment needs manual review. Contact Minuto support and quote your order ID."
      : data?.message ?? `Payment status: ${data?.status ?? "unknown"}.`;
    try {
      await refresh();
      setNotice(statusNotice);
    } catch (refreshError: unknown) {
      setNotice(`${statusNotice} The payment status was verified, but the order list could not refresh: ${messageFor(refreshError)}`);
    }
  }, [client, refresh, setNotice]);

  useEffect(() => {
    let active = true;
    async function loadMarketplace() {
      try {
        await refresh();
      } catch (error: unknown) {
        if (active) setNotice(`Could not refresh marketplace: ${messageFor(error)}`);
      }
    }
    void loadMarketplace();
    let channel = client.channel(`live-${profile.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_jobs" }, () => {
        void refresh().catch((error: unknown) => setNotice(`Could not refresh delivery jobs: ${messageFor(error)}`));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "delivery_agent_locations" }, () => {
        void refresh().catch((error: unknown) => setNotice(`Could not refresh live agent location: ${messageFor(error)}`));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${profile.id}` }, () => {
        void refresh().catch((error: unknown) => setNotice(`Could not refresh notifications: ${messageFor(error)}`));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "products" }, () => {
        void refresh().catch((error: unknown) => setNotice(`Could not refresh products: ${messageFor(error)}`));
      });
    if (profile.role === "buyer") {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        void refresh().catch((error: unknown) => setNotice(`Could not refresh orders: ${messageFor(error)}`));
      });
    } else if (profile.role === "vendor") {
      channel = channel.on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "seller_payouts",
        filter: `vendor_id=eq.${profile.id}`,
      }, () => {
        void refresh().catch((error: unknown) => setNotice(`Could not refresh seller payouts: ${messageFor(error)}`));
      });
    }
    channel.subscribe();
    return () => { active = false; void client.removeChannel(channel); };
  }, [client, profile.id, profile.role, refresh, setNotice]);

  async function markNotificationRead(notification: AppNotification) {
    if (notification.read_at) return;
    const { error } = await client.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", notification.id).eq("user_id", profile.id);
    if (error) throw error;
    setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item));
  }

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const pendingPayments = profile.role === "buyer"
        ? buyerOrders.filter((order) => order.payment_method === "upi" && order.payment_status === "pending")
        : [];
      if (pendingPayments.length) {
        void syncUpiPayment(pendingPayments[0].id).catch((error: unknown) => {
          setNotice(`Could not verify UPI payment: ${messageFor(error)}`);
        });
        return;
      }
      void refresh().catch((error: unknown) => {
        setNotice(`Could not refresh marketplace: ${messageFor(error)}`);
      });
    });
    return () => subscription.remove();
  }, [buyerOrders, profile.role, refresh, setNotice, syncUpiPayment]);

  const visibleProducts = useMemo(() => products.filter((product) =>
    `${product.name} ${product.details} ${product.vendor_name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()),
  ), [products, search]);
  const cartLines = Object.entries(cart)
    .map(([productId, quantity]) => ({ product: products.find((item) => item.id === productId), quantity }))
    .filter((line): line is { product: Product; quantity: number } => line.product !== undefined);
  const itemSubtotal = cartLines.reduce((sum, line) => sum + line.product.seller_price * line.quantity, 0);
  const itemMarkup = cartLines.reduce((sum, line) => sum + 5 * line.quantity, 0);
  const buyerDeliveryContribution = cartLines.length ? 6 : 0;
  const cartTotal = itemSubtotal + itemMarkup + buyerDeliveryContribution;
  const sellerOrders = orders.filter((job) => job.vendor_id === profile.id);
  const visibleSellerOrders = sellerOrders.filter((job) => sellerOrderFilter === "active"
    ? !["delivered", "cancelled"].includes(job.status)
    : ["delivered", "cancelled"].includes(job.status));
  const sellerProducts = products.filter((product) => product.vendor_id === profile.id);
  const lowStockProducts = sellerProducts.filter((product) => product.stock <= 3);
  const sellerPaidTotal = sellerPayouts.filter((payout) => payout.status === "paid").reduce((sum, payout) => sum + payout.amount, 0);
  const sellerFulfilledOrders = sellerOrders.filter((job) => job.status === "delivered").length;
  const sellerCatalogueValue = sellerProducts.filter((product) => product.active).reduce((sum, product) => sum + product.seller_price * product.stock, 0);

  async function signOut() {
    const { error } = await client.auth.signOut();
    if (error) setNotice(`Could not sign out: ${messageFor(error)}`);
  }

  async function addProduct() {
    if (profile.role === "vendor" && (!profile.seller_upi_id || !profile.seller_phone)) {
      throw new Error("Set up your seller UPI ID and mobile number before publishing listings.");
    }
    const priceValue = Number(price);
    const stockValue = Number(stock);
    if (name.trim().length < 2 || name.trim().length > 70 || details.trim().length < 2 || details.trim().length > 300) {
      throw new Error("Use a product name of 2–70 characters and details of 2–300 characters.");
    }
    if (!categories.includes(category)) throw new Error("Choose a valid product category.");
    if (!Number.isInteger(priceValue) || priceValue < 1 || priceValue > 100000
      || !Number.isInteger(stockValue) || stockValue < 1 || stockValue > 10000) {
      throw new Error("Enter a whole-rupee price up to ₹1,00,000 and stock from 1 to 10,000.");
    }
    if (!photo) throw new Error("Choose a product photo.");
    const mime = photo.mimeType ?? "image/jpeg";
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime) || (photo.fileSize ?? 0) > 8 * 1024 * 1024) {
      throw new Error("Choose a JPG, PNG, or WebP photo smaller than 8 MB.");
    }
    const path = `${profile.id}/${Date.now()}.${mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg"}`;
    const imageResponse = await fetch(photo.uri);
    if (!imageResponse.ok) throw new Error("Could not read selected product photo.");
    const { error: uploadError } = await client.storage.from("product-images").upload(path, await imageResponse.blob(), { contentType: mime, upsert: false });
    if (uploadError) throw uploadError;
    const { data: urlData } = client.storage.from("product-images").getPublicUrl(path);
    const { error } = await client.from("products").insert({
      vendor_id: profile.id,
      vendor_name: profile.display_name,
      name: name.trim(),
      details: details.trim(),
      category,
      seller_price: priceValue,
      stock: stockValue,
      image_path: path,
      image_url: urlData.publicUrl,
      active: true,
    });
    if (error) {
      const { error: removeError } = await client.storage.from("product-images").remove([path]);
      if (removeError) console.warn("Could not remove photo after failed product save", removeError);
      throw error;
    }
    setName(""); setDetails(""); setPrice(""); setStock("10"); setPhoto(null);
    try {
      await refresh();
      setNotice("Your listing is live.");
    } catch (error: unknown) {
      setNotice(`Your listing was published, but the screen could not refresh: ${messageFor(error)}`);
    }
  }

  async function saveSellerPaymentDetails() {
    await onSaveVendorPaymentDetails(sellerUpiId, sellerPhone);
    setSellerPhone(sellerPhone.replace(/\D/g, ""));
    setNotice("Seller payment details saved. Remember, buyer UPI payments are not transferred automatically.");
  }

  async function saveSellerPickupAddress() {
    const pickup = vendorAddress.trim();
    if (pickup.length < 5 || pickup.length > 160) {
      throw new Error("Enter a pickup address between 5 and 160 characters.");
    }
    const { error } = await client.from("profiles")
      .update({ pickup_address: pickup })
      .eq("id", profile.id);
    if (error) throw error;
    setVendorAddress(pickup);
    setNotice("Pickup address saved for future deliveries.");
  }

  async function toggleProduct(product: Product) {
    const { error } = await client.from("products").update({ active: !product.active }).eq("id", product.id).eq("vendor_id", profile.id);
    if (error) throw error;
    await refresh();
    setNotice(product.active ? "Listing paused. Buyers can no longer order it." : "Listing is live again.");
  }

  async function saveProductInventory(product: Product) {
    const draft = productEdits[product.id] ?? { price: String(product.seller_price), stock: String(product.stock) };
    const nextPrice = Number(draft.price);
    const nextStock = Number(draft.stock);
    if (!Number.isInteger(nextPrice) || nextPrice < 1 || nextPrice > 100000) {
      throw new Error("Price must be a whole rupee amount between ₹1 and ₹1,00,000.");
    }
    if (!Number.isInteger(nextStock) || nextStock < 0 || nextStock > 10000) {
      throw new Error("Stock must be a whole number between 0 and 10,000.");
    }
    const { error } = await client.from("products")
      .update({ seller_price: nextPrice, stock: nextStock })
      .eq("id", product.id)
      .eq("vendor_id", profile.id);
    if (error) throw error;
    await refresh();
    setNotice("Listing inventory updated.");
  }

  function validateDeliveryDetails() {
    if (!cartLines.length) throw new Error("Add products to your bag first.");
    normalizeIndianPhone(phone);
    if (address.trim().length < 5 || area.trim().length < 2 || !/^\d{6}$/.test(postalCode.trim())) {
      throw new Error("Enter your Nagpur delivery address and six-digit PIN code.");
    }
  }

  function deliveryDetails() {
    return {
      phone: phone.replace(/\D/g, ""),
      address: address.trim(),
      area: area.trim(),
      city: "Nagpur, Maharashtra",
      postal_code: postalCode.trim(),
    };
  }

  async function checkout() {
    validateDeliveryDetails();
    const { error } = await client.rpc("place_marketplace_order", {
      p_items: cartLines.map(({ product, quantity }) => ({ product_id: product.id, quantity })),
      p_delivery: deliveryDetails(),
    });
    if (error) throw error;
    setCart({});
    try {
      await refresh();
      setNotice("Order placed. Each vendor delivery will be offered to an agent.");
    } catch (refreshError: unknown) {
      setNotice(`Order placed, but the screen could not refresh: ${messageFor(refreshError)}`);
    }
  }

  async function startUpiCheckout(existingOrderId?: string) {
    let orderId = existingOrderId;
    if (!orderId) {
      validateDeliveryDetails();
      const { data, error } = await client.rpc("place_marketplace_order_upi", {
        p_items: cartLines.map(({ product, quantity }) => ({ product_id: product.id, quantity })),
        p_delivery: deliveryDetails(),
      });
      if (error) throw error;
      if (typeof data !== "string") throw new Error("Could not create a UPI order.");
      orderId = data;
      setPendingPaymentOrderId(orderId);
    }

    const { data, error } = await client.functions.invoke<{ checkoutUrl: string }>("create-youpi-payment", {
      body: { orderId },
    });
    if (error) {
      if (error.context instanceof Response) {
        const responseBody: unknown = await error.context.clone().json().catch(() => null);
        if (typeof responseBody === "object" && responseBody !== null
          && "error" in responseBody && typeof responseBody.error === "string") {
          throw new Error(responseBody.error);
        }
      }
      throw error;
    }
    if (!data?.checkoutUrl?.startsWith("https://")) {
      throw new Error("The gateway did not return a secure checkout URL.");
    }
    await Linking.openURL(data.checkoutUrl);
    setCart({});
    setPendingPaymentOrderId(null);
    try {
      await refresh();
      setNotice("UPI checkout opened. Your order will be confirmed after the gateway verifies payment.");
    } catch (refreshError: unknown) {
      setNotice(`UPI checkout opened. Payment still requires gateway confirmation; order refresh failed: ${messageFor(refreshError)}`);
    }
  }

  async function takeJob(job: DeliveryJob) {
    const { data, error } = await client.rpc("accept_delivery_job", { p_job_id: job.id });
    if (error) throw error;
    if (!data) throw new Error("Another agent accepted that delivery first.");
    try {
      await refresh();
      setNotice("Delivery accepted. Pickup and customer address are ready.");
    } catch (refreshError: unknown) {
      setNotice(`Delivery accepted, but the screen could not refresh: ${messageFor(refreshError)}`);
    }
  }

  async function updateJob(job: DeliveryJob, status: "ready" | "picked_up" | "delivered", proof?: { otp: string; note: string; photo: ImagePicker.ImagePickerAsset | null }) {
    if (status === "ready") {
      const { error } = await client.rpc("prepare_delivery_job", {
        p_job_id: job.id,
        p_pickup_address: vendorAddress.trim(),
      });
      if (error) throw error;
    } else {
      let photoPath: string | null = null;
      if (status === "delivered" && proof?.photo) {
        const mime = proof.photo.mimeType ?? "image/jpeg";
        if (!["image/jpeg", "image/png", "image/webp"].includes(mime) || (proof.photo.fileSize ?? 0) > 8 * 1024 * 1024) {
          throw new Error("Choose a JPG, PNG, or WebP photo smaller than 8 MB.");
        }
        const safePhotoName = (proof.photo.fileName ?? "delivery-proof").replace(/[^a-zA-Z0-9._-]/g, "-");
        photoPath = `${profile.id}/${job.id}-${safePhotoName}`;
        const imageResponse = await fetch(proof.photo.uri);
        if (!imageResponse.ok) throw new Error("Could not read the delivery photo.");
        const { error: uploadError } = await client.storage.from("delivery-proof").upload(photoPath, await imageResponse.blob(), { contentType: mime, upsert: true });
        if (uploadError) throw uploadError;
      }
      const { error } = await client.rpc("advance_delivery_job", {
        p_job_id: job.id,
        p_status: status,
        p_otp: proof?.otp.trim() || null,
        p_proof_note: proof?.note.trim() || null,
        p_proof_photo_path: photoPath,
      });
      if (error) throw error;
    }

    try {
      await refresh();
    } catch (refreshError: unknown) {
      setNotice(`Delivery status updated, but the screen could not refresh: ${messageFor(refreshError)}`);
    }
  }

  async function showDeliveryOtp(job: DeliveryJob) {
    const { data, error } = await client.rpc("get_delivery_otp", { p_job_id: job.id });
    if (error) throw error;
    if (typeof data !== "string" || !/^\d{4}$/.test(data)) throw new Error("The delivery code is not available yet.");
    setDeliveryOtps((current) => ({ ...current, [job.id]: data }));
  }

  async function chooseProofPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.75 });
    if (!result.canceled) setProofPhoto(result.assets[0]);
  }

  async function submitDeliveryProof(job: DeliveryJob) {
    await updateJob(job, "delivered", { otp: proofOtp, note: proofNote, photo: proofPhoto });
    setProofJobId(null);
    setProofOtp("");
    setProofNote("");
    setProofPhoto(null);
  }

  async function toggleFavorite(product: Product) {
    const isSaved = favorites.includes(product.id);
    const response = isSaved
      ? await client.from("favorites").delete().eq("user_id", profile.id).eq("product_id", product.id)
      : await client.from("favorites").insert({ user_id: profile.id, product_id: product.id });
    const { error } = response;
    if (error) throw error;
    setFavorites(isSaved ? favorites.filter((id) => id !== product.id) : [...favorites, product.id]);
    try {
      await refresh();
    } catch (refreshError: unknown) {
      setNotice(`Favorite updated, but the screen could not refresh: ${messageFor(refreshError)}`);
    }
  }

  async function openAddress(job: DeliveryJob, routeStatus = job.status) {
    const destination = routeStatus === "accepted" ? job.vendor_address : `${job.buyer_address}, ${job.buyer_area}, Nagpur ${job.buyer_postal_code}`;
    if (!destination.trim()) throw new Error("The address is missing; contact support before traveling.");
    const url = directionsUrl(destination);
    const supported = await Linking.canOpenURL(url);
    if (!supported) throw new Error("Could not open Maps on this device.");
    await Linking.openURL(url);
  }

  async function saveAddress() {
    if (newAddressLabel.trim().length < 2 || newAddress.trim().length < 5 || newArea.trim().length < 2 || !/^\d{6}$/.test(newPostalCode.trim())) {
      throw new Error("Enter a label, address, area, and six-digit PIN code.");
    }
    const { data, error } = await client.from("saved_addresses").insert({
      user_id: profile.id,
      label: newAddressLabel.trim(),
      address: newAddress.trim(),
      area: newArea.trim(),
      postal_code: newPostalCode.trim(),
    }).select("id,label,address,area,postal_code").single();
    if (error) throw error;
    setSavedAddresses((current) => [data as SavedAddress, ...current]);
    setSelectedAddressId(data.id);
    setNewAddressLabel(""); setNewAddress(""); setNewArea(""); setNewPostalCode("");
    setNotice("Address saved for orders and service bookings.");
  }

  async function addReminder() {
    const title = newReminder.trim();
    if (title.length < 2 || title.length > 100) throw new Error("Reminder must be between 2 and 100 characters.");
    const dueAt = reminderDueAt === "today"
      ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      : reminderDueAt === "week"
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : reminderDueAt === "month"
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          : null;
    const { data, error } = await client.from("life_reminders")
      .insert({ user_id: profile.id, title, due_at: dueAt })
      .select("id,title,due_at,completed")
      .single();
    if (error) throw error;
    setReminders((current) => [...current, data as LifeReminder]);
    setNewReminder("");
    setReminderDueAt(null);
    setNotice("Reminder added to your Minuto day.");
  }

  async function toggleReminder(reminder: LifeReminder) {
    const { error } = await client.from("life_reminders")
      .update({ completed: !reminder.completed })
      .eq("id", reminder.id)
      .eq("user_id", profile.id);
    if (error) throw error;
    setReminders((current) => current.map((item) => item.id === reminder.id ? { ...item, completed: !item.completed } : item));
  }

  async function deleteReminder(reminder: LifeReminder) {
    const { error } = await client.from("life_reminders").delete().eq("id", reminder.id).eq("user_id", profile.id);
    if (error) throw error;
    setReminders((current) => current.filter((item) => item.id !== reminder.id));
  }

  async function requestServiceBooking() {
    if (!selectedProvider) throw new Error("Choose a provider first.");
    if (!selectedAddressId) throw new Error("Add or choose a saved address first.");
    if (!selectedBookingSlot) throw new Error("Choose an appointment time first.");
    const requestedFor = new Date();
    if (selectedBookingSlot === "today-evening") {
      requestedFor.setHours(18, 0, 0, 0);
    } else if (selectedBookingSlot === "tomorrow-morning") {
      requestedFor.setDate(requestedFor.getDate() + 1);
      requestedFor.setHours(10, 0, 0, 0);
    } else {
      requestedFor.setDate(requestedFor.getDate() + 1);
      requestedFor.setHours(18, 0, 0, 0);
    }
    if (requestedFor.getTime() <= Date.now()) throw new Error("Today’s slot has passed. Choose tomorrow instead.");
    const { error } = await client.rpc("request_service_booking", {
      p_provider_id: selectedProvider.id,
      p_requested_for: requestedFor.toISOString(),
      p_address_id: selectedAddressId,
      p_notes: search.trim(),
    });
    if (error) throw error;
    setSelectedProvider(null);
    setSelectedBookingSlot(null);
    setSelectedService(null);
    await refresh();
    setNotice("Service request sent. We’ll confirm the provider before the appointment.");
  }

  function run(action: () => Promise<unknown>) {
    setBusy(true);
    void action().catch((error: unknown) => setNotice(messageFor(error))).finally(() => setBusy(false));
  }

  const tabs = profile.role === "buyer"
    ? [["home", "Home"], ["shop", "Shop"], ["services", "Services"], ["cart", `Bag · ${Object.values(cart).reduce((a, b) => a + b, 0)}`], ["activity", "Activity"]]
    : profile.role === "vendor"
      ? [["dashboard", "Workspace"], ["products", "Listings"], ["orders", "Orders"]]
      : [["jobs", "Delivery jobs"]];

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <View><Text style={styles.brand}>minuto</Text><Text style={styles.note}>Nagpur · {labelForRole[profile.role ?? "buyer"]}</Text></View>
        <Pressable onPress={() => void signOut()}><Text style={styles.link}>Sign out</Text></Pressable>
      </View>
      {notice ? <Pressable accessibilityRole="alert" onPress={() => setNotice("")} style={styles.notice}><Text style={styles.paragraph}>{notice}</Text></Pressable> : null}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
         {notifications.length ? <View style={styles.notificationShelf}><View style={styles.notificationShelfTop}><Text style={styles.serviceEyebrow}>MINUTO UPDATES</Text><Text style={styles.notificationCount}>{notifications.filter((item) => !item.read_at).length} unread</Text></View>{notifications.slice(0, 3).map((notification) => <Pressable key={notification.id} onPress={() => void run(() => markNotificationRead(notification))} style={[styles.notificationRow, !notification.read_at && styles.notificationUnread]}><View style={styles.notificationDot} /><View style={styles.grow}><Text style={styles.notificationTitle}>{notification.title}</Text><Text style={styles.notificationBody}>{notification.body}</Text></View><Text style={styles.notificationTime}>{new Date(notification.created_at).toLocaleDateString()}</Text></Pressable>)}</View> : null}
         {profile.role === "vendor" && tab === "dashboard" && <>
          <Text style={styles.kicker}>SELLER WORKSPACE · NAGPUR</Text>
          <Text style={styles.heading}>Good evening, {profile.display_name.split(" ")[0]}.</Text>
          <Text style={styles.paragraph}>A calm view of your listings, orders, and earnings.</Text>
          <View style={styles.sellerHero}>
            <View style={styles.sellerHeroTop}><Text style={styles.serviceEyebrow}>MINUTO SELLER DESK</Text><Text style={styles.sellerLive}>● LIVE</Text></View>
            <Text style={styles.sellerHeroTitle}>Your local shop,{`\n`}moving beautifully.</Text>
            <Text style={styles.sellerHeroText}>Keep products fresh, prepare orders quickly, and build trust with every delivery.</Text>
          </View>
          <View style={styles.sellerMetricGrid}>
            <View style={styles.sellerMetric}><Text style={styles.sellerMetricValue}>{sellerProducts.filter((product) => product.active).length}</Text><Text style={styles.sellerMetricLabel}>Live listings</Text></View>
            <View style={styles.sellerMetric}><Text style={styles.sellerMetricValue}>{sellerOrders.filter((job) => !["delivered", "cancelled"].includes(job.status)).length}</Text><Text style={styles.sellerMetricLabel}>Open orders</Text></View>
            <View style={styles.sellerMetric}><Text style={styles.sellerMetricValue}>{formatMoney(sellerPayouts.filter((payout) => payout.status === "pending").reduce((sum, payout) => sum + payout.amount, 0))}</Text><Text style={styles.sellerMetricLabel}>Pending payout</Text></View>
          </View>
          <View style={styles.sellerSnapshot}><Text style={styles.serviceEyebrow}>PERFORMANCE SNAPSHOT</Text><View style={styles.sellerSnapshotGrid}><View><Text style={styles.sellerSnapshotValue}>{sellerFulfilledOrders}</Text><Text style={styles.sellerSnapshotLabel}>Fulfilled orders</Text></View><View><Text style={styles.sellerSnapshotValue}>{formatMoney(sellerPaidTotal)}</Text><Text style={styles.sellerSnapshotLabel}>Paid out</Text></View><View><Text style={styles.sellerSnapshotValue}>{formatMoney(sellerCatalogueValue)}</Text><Text style={styles.sellerSnapshotLabel}>Catalogue value</Text></View></View></View>
          <View style={styles.sellerActionGrid}>
            <Pressable style={styles.sellerActionCard} onPress={() => setTab("products")}><Text style={styles.sellerActionIcon}>+</Text><Text style={styles.cardTitle}>Add listing</Text><Text style={styles.note}>Publish a new local find</Text></Pressable>
            <Pressable style={styles.sellerActionCard} onPress={() => setTab("orders")}><Text style={styles.sellerActionIcon}>→</Text><Text style={styles.cardTitle}>Prepare orders</Text><Text style={styles.note}>Keep delivery moving</Text></Pressable>
          </View>
          <View style={styles.sellerSectionHeader}><Text style={styles.sectionTitle}>Today’s attention</Text><Pressable onPress={() => setTab("orders")}><Text style={styles.link}>Open orders →</Text></Pressable></View>
          {orders.filter((job) => job.vendor_id === profile.id && !["delivered", "cancelled"].includes(job.status)).slice(0, 3).map((job) => <View key={job.id} style={styles.sellerOrderRow}><View style={styles.sellerStatusDot} /><View style={styles.grow}><Text style={styles.cardTitle}>{job.buyer_name || "Buyer order"}</Text><Text style={styles.note}>{job.status.replaceAll("_", " ")} · {job.buyer_area}</Text></View><Text style={styles.sellerOrderArrow}>›</Text></View>)}
          {!orders.some((job) => job.vendor_id === profile.id && !["delivered", "cancelled"].includes(job.status)) ? <View style={styles.sellerEmpty}><Text style={styles.cardTitle}>Your queue is clear</Text><Text style={styles.note}>New orders will appear here as soon as buyers place them.</Text></View> : null}
          <View style={styles.sellerSectionHeader}><Text style={styles.sectionTitle}>Listing health</Text><Pressable onPress={() => setTab("products")}><Text style={styles.link}>Manage →</Text></Pressable></View>
          <Text style={styles.note}>{sellerProducts.filter((product) => product.active && product.stock > 0).length} listings are visible to buyers with stock available.</Text>
          {lowStockProducts.length ? <View style={styles.sellerLowStockCard}><View style={styles.sellerLowStockHeader}><Text style={styles.serviceEyebrow}>RESTOCK WATCH</Text><Text style={styles.sellerLowStockCount}>{lowStockProducts.length}</Text></View>{lowStockProducts.slice(0, 4).map((product) => <View key={product.id} style={styles.sellerLowStockRow}><View style={styles.grow}><Text style={styles.cardTitle}>{product.name}</Text><Text style={styles.note}>{product.stock === 0 ? "Out of stock" : `${product.stock} left · update before it runs out`}</Text></View><Text style={[styles.sellerStockBadge, { color: product.stock === 0 ? "#9D4438" : "#B18A39" }]}>{product.stock === 0 ? "EMPTY" : "LOW"}</Text></View>)}{lowStockProducts.length > 4 ? <Text style={styles.note}>+ {lowStockProducts.length - 4} more listings need attention.</Text> : null}<Button title="Open catalogue →" secondary onPress={() => setTab("products")} /></View> : <View style={styles.sellerHealthyCard}><Text style={styles.sellerHealthyMark}>✓</Text><View style={styles.grow}><Text style={styles.cardTitle}>Stock is looking healthy</Text><Text style={styles.note}>No listing has reached the low-stock threshold.</Text></View></View>}
        </>}
        {profile.role === "buyer" && tab === "home" && <>
          <Text style={styles.kicker}>YOUR DAY · NAGPUR</Text>
          <Text style={styles.heading}>Good evening, {profile.display_name.split(" ")[0]}.</Text>
          <Text style={styles.paragraph}>Everything you need for today, in one calm place.</Text>
          <Field label="Search Minuto" value={search} onChangeText={setSearch} placeholder="Try “bike puncture” or “milk”" />
          {search.trim() ? <View style={styles.searchPanel}>
            <Text style={styles.fieldLabel}>SEARCH RESULTS</Text>
            {visibleProducts.slice(0, 3).map((product) => <Pressable key={product.id} onPress={() => setTab("shop")} style={styles.searchResult}><Text style={styles.cardTitle}>{product.name}</Text><Text style={styles.note}>Product · {product.vendor_name}</Text></Pressable>)}
            {everydayServices.filter((service) => `${service.title} ${service.description}`.toLowerCase().includes(search.toLowerCase())).map((service) => <Pressable key={service.id} onPress={() => { setSelectedService(service); setTab("services"); }} style={styles.searchResult}><Text style={styles.cardTitle}>{service.title}</Text><Text style={styles.note}>Service · {service.provider}</Text></Pressable>)}
            <Text style={styles.note}>Search results will include trusted providers, products, bookings, and help as those services go live.</Text>
          </View> : null}
          <View style={styles.homeCard}>
            <View style={styles.homeCardHeader}><Text style={styles.serviceEyebrow}>MINUTO ASSURED</Text><Text style={styles.homeBadge}>PLUS READY</Text></View>
            <Text style={styles.homeCardTitle}>Your everyday life, handled.</Text>
            <Text style={styles.serviceHighlightText}>Verified local providers, clear pricing, and support when you need it.</Text>
          </View>
          <Text style={styles.sectionTitle}>Your Minuto menu</Text>
          <View style={styles.menuList}>{quickActions.map(([action, title, subtitle]) => <Pressable key={title} onPress={() => setTab(action)} style={styles.menuRow}><View style={styles.menuIcon}><Text style={styles.menuIconText}>{title.charAt(0)}</Text></View><View style={styles.grow}><Text style={styles.quickActionTitle}>{title}</Text><Text style={styles.note}>{subtitle}</Text></View><Text style={styles.menuArrow}>›</Text></Pressable>)}</View>
          <Text style={styles.sectionTitle}>Your day</Text>
          <View style={styles.timelineCard}>
            <Text style={styles.cardTitle}>Nothing booked yet</Text>
            <Text style={styles.paragraph}>Your orders, appointments, reminders, and provider updates will appear here.</Text>
            <Button title="Explore everyday services" secondary onPress={() => setTab("services")} />
          </View>
        </>}
        {profile.role === "buyer" && tab === "shop" && <>
          <Text style={styles.kicker}>LOCAL FINDS · NAGPUR</Text><Text style={styles.heading}>Good things, close by.</Text>
          <Field label="Search vendors and products" value={search} onChangeText={setSearch} placeholder="Search…" />
          {visibleProducts.map((product) => <ProductRow key={product.id} product={product} quantity={cart[product.id] ?? 0} saved={favorites.includes(product.id)} onFavorite={() => run(() => toggleFavorite(product))} onAdd={product.stock > 0 ? () => setCart((current) => ({ ...current, [product.id]: Math.min(99, product.stock, (current[product.id] ?? 0) + 1) })) : undefined} />)}
        </>}
        {profile.role === "buyer" && tab === "services" && <>
          <Text style={styles.kicker}>LIFE, SORTED · NAGPUR</Text>
          <Text style={styles.heading}>A little help, right when you need it.</Text>
          <Text style={styles.paragraph}>Book trusted local services and handle the small things without leaving Minuto.</Text>
          {!selectedService ? <>
            <View style={styles.serviceHighlight}>
              <Text style={styles.serviceEyebrow}>NEW ON MINUTO</Text>
              <Text style={styles.serviceHighlightTitle}>Your day, made easier.</Text>
              <Text style={styles.serviceHighlightText}>From a fresh haircut to a mechanic at your doorstep, find everyday help in a few taps.</Text>
            </View>
            {everydayServices.map((service) => <Pressable key={service.id} onPress={() => { setSelectedService(service); setSelectedProvider(null); setSelectedBookingSlot(null); }} style={styles.serviceCard}>
              <View style={styles.serviceCardTop}>
                <Text style={styles.serviceCategory}>{service.category.toUpperCase()}</Text>
                <Text style={styles.serviceMeta}>{service.meta}</Text>
              </View>
              <Text style={styles.cardTitle}>{service.title}</Text>
              <Text style={styles.paragraph}>{service.description}</Text>
              <View style={styles.serviceFooter}><Text style={styles.note}>{service.provider}</Text><Text style={styles.serviceAction}>{service.action}  →</Text></View>
            </Pressable>)}
          </> : <>
            <Pressable onPress={() => setSelectedService(null)}><Text style={styles.link}>← All services</Text></Pressable>
            <View style={styles.serviceDetail}>
              <Text style={styles.serviceCategory}>{selectedService.category.toUpperCase()}</Text>
              <Text style={styles.heading}>{selectedService.title}</Text>
              <Text style={styles.paragraph}>{selectedService.description}</Text>
              <Text style={styles.note}>{selectedService.provider} · {selectedService.meta}</Text>
              <Field label="Tell us what you need" value={search} onChangeText={setSearch} placeholder={selectedService.id === "mechanic" ? "e.g. Flat tyre near Dharampeth" : "Add a few details"} multiline />
              <Text style={styles.fieldLabel}>Available providers</Text>
              {serviceProviders.filter((provider) => provider.category === selectedService.category).map((provider) => <Pressable key={provider.id} onPress={() => setSelectedProvider(provider)} style={[styles.providerCard, selectedProvider?.id === provider.id && styles.providerSelected]}>
                <View style={styles.serviceCardTop}><Text style={styles.cardTitle}>{provider.name}</Text><Text style={styles.serviceMeta}>{provider.verified ? "✓ Verified" : "Local provider"}</Text></View>
                <Text style={styles.note}>{provider.description}</Text>
                <Text style={styles.note}>{provider.service_area} · {provider.rating.toFixed(1)} ★ ({provider.review_count}) · From {formatMoney(provider.starting_price)}</Text>
              </Pressable>)}
              {!serviceProviders.some((provider) => provider.category === selectedService.category) ? <Text style={styles.paragraph}>No providers are available in this category yet. Provider onboarding is ready for the Minuto team.</Text> : null}
              {selectedProvider ? <>
                <Text style={styles.fieldLabel}>Choose an appointment time</Text>
                <View style={styles.chips}>{[["today-evening", "Today · 6 PM"], ["tomorrow-morning", "Tomorrow · 10 AM"], ["tomorrow-evening", "Tomorrow · 6 PM"]].map(([value, label]) => <Pressable key={value} onPress={() => setSelectedBookingSlot(value as "today-evening" | "tomorrow-morning" | "tomorrow-evening")} style={[styles.chip, selectedBookingSlot === value && styles.chipSelected]}><Text>{label}</Text></Pressable>)}</View>
                <Text style={styles.fieldLabel}>Service address</Text>
                {savedAddresses.map((savedAddress) => <Pressable key={savedAddress.id} onPress={() => setSelectedAddressId(savedAddress.id)} style={[styles.addressCard, selectedAddressId === savedAddress.id && styles.providerSelected]}><Text style={styles.cardTitle}>{savedAddress.label}</Text><Text style={styles.note}>{savedAddress.address}, {savedAddress.area} {savedAddress.postal_code}</Text></Pressable>)}
                <Button title="Request this service" disabled={busy} onPress={() => run(requestServiceBooking)} />
              </> : null}
              <Text style={styles.note}>Providers are shown with clear pricing and availability before you confirm.</Text>
            </View>
          </>}
        </>}
        {profile.role === "buyer" && tab === "activity" && <>
          <Text style={styles.kicker}>ONE PLACE FOR EVERYTHING</Text>
          <Text style={styles.heading}>Your Minuto activity</Text>
          <View style={styles.activitySummary}>
            <View><Text style={styles.note}>MINUTO REWARDS</Text><Text style={styles.rewardPoints}>240 pts</Text></View>
            <View><Text style={styles.note}>THIS MONTH</Text><Text style={styles.cardTitle}>₹0 saved</Text></View>
          </View>
          <Text style={styles.sectionTitle}>Upcoming</Text>
          {serviceBookings.length === 0 ? <View style={styles.timelineCard}><Text style={styles.cardTitle}>No upcoming bookings</Text><Text style={styles.paragraph}>Book a barber, mechanic, or home service and track it here.</Text><Button title="Find a service" onPress={() => setTab("services")} /></View> : serviceBookings.slice(0, 5).map((booking) => <View key={booking.id} style={styles.timelineCard}>
            <Text style={styles.cardTitle}>{booking.service_providers?.[0]?.name ?? "Service provider"} · {booking.status}</Text>
            <Text style={styles.paragraph}>{new Date(booking.requested_for).toLocaleString()} · {booking.address}</Text>
            {["requested", "confirmed"].includes(booking.status) ? <Button title="Cancel booking" secondary disabled={busy} onPress={() => run(async () => {
              const { error } = await client.rpc("cancel_service_booking", { p_booking_id: booking.id });
              if (error) throw error;
              await refresh();
              setNotice("Your service booking was cancelled.");
            })} /> : null}
            {booking.status === "completed" && !booking.service_reviews?.length ? <>
              <Text style={styles.fieldLabel}>How was your service?</Text>
              <View style={styles.chips}>{[1, 2, 3, 4, 5].map((rating) => <Pressable key={rating} onPress={() => setReviewRatings((current) => ({ ...current, [booking.id]: rating }))} style={[styles.ratingChip, reviewRatings[booking.id] === rating && styles.ratingChipSelected]}><Text>{rating} ★</Text></Pressable>)}</View>
              <Field label="Review (optional)" value={reviewTexts[booking.id] ?? ""} onChangeText={(value) => setReviewTexts((current) => ({ ...current, [booking.id]: value }))} placeholder="Tell us about the experience" multiline />
              <Button title="Submit review" disabled={busy || !reviewRatings[booking.id]} onPress={() => run(async () => {
                const { error } = await client.rpc("submit_service_review", { p_booking_id: booking.id, p_rating: reviewRatings[booking.id], p_review: reviewTexts[booking.id] ?? "" });
                if (error) throw error;
                await refresh();
                setNotice("Thanks for helping the Minuto community choose with confidence.");
              })} />
            </> : null}
          </View>)}
          <Text style={styles.sectionTitle}>Saved places</Text>
          <View style={styles.timelineCard}><Text style={styles.cardTitle}>Add Home and Office</Text><Text style={styles.paragraph}>Save addresses once and use them for orders, bookings, and urgent help.</Text>{savedAddresses.map((savedAddress) => <Text key={savedAddress.id} style={styles.note}>{savedAddress.label} · {savedAddress.area}</Text>)}<Field label="Label" value={newAddressLabel} onChangeText={setNewAddressLabel} placeholder="Home or Office" /><Field label="Address" value={newAddress} onChangeText={setNewAddress} placeholder="House and street" /><Field label="Area" value={newArea} onChangeText={setNewArea} placeholder="Locality" /><Field label="PIN code" value={newPostalCode} onChangeText={setNewPostalCode} placeholder="6 digits" keyboard="number-pad" /><Button title="Save address" secondary onPress={() => run(saveAddress)} /></View>
          <Text style={styles.sectionTitle}>Helpful reminders</Text>
          <View style={styles.timelineCard}>
            <Field label="Add a reminder" value={newReminder} onChangeText={setNewReminder} placeholder="e.g. Service my bike next month" />
            <Text style={styles.fieldLabel}>When should we remind you?</Text>
            <View style={styles.chips}>{[["today", "Tomorrow"], ["week", "This week"], ["month", "Next month"]].map(([value, label]) => <Pressable key={value} onPress={() => setReminderDueAt(value as "today" | "week" | "month")} style={[styles.chip, reminderDueAt === value && styles.chipSelected]}><Text>{label}</Text></Pressable>)}</View>
            <Button title="Add reminder" secondary disabled={busy} onPress={() => run(addReminder)} />
          </View>
          {reminders.length === 0 ? <Text style={styles.paragraph}>No reminders yet. Add one for vehicle service, essentials, or self-care.</Text> : reminders.map((reminder) => <View key={reminder.id} style={styles.reminderRow}><Pressable onPress={() => run(() => toggleReminder(reminder))} style={styles.grow}><Text style={[styles.cardTitle, reminder.completed && styles.completedText]}>{reminder.title}</Text><Text style={styles.note}>{reminder.completed ? "Completed" : reminder.due_at ? `Due ${new Date(reminder.due_at).toLocaleDateString()}` : "No due date"}</Text></Pressable><Text style={styles.reminderCheck}>{reminder.completed ? "✓" : "○"}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Delete reminder ${reminder.title}`} onPress={() => run(() => deleteReminder(reminder))}><Text style={styles.deleteText}>×</Text></Pressable></View>)}
        </>}
        {profile.role === "buyer" && tab === "cart" && <>
          <Text style={styles.heading}>Your bag</Text>
          {cartLines.map(({ product, quantity }) => <View key={product.id} style={styles.row}>
            <View><Text style={styles.cardTitle}>{quantity} × {product.name}</Text><Text style={styles.note}>Includes ₹5 Minuto markup per item</Text></View>
            <Text>{formatMoney((product.seller_price + 5) * quantity)}</Text>
          </View>)}
          <Field label="Mobile" value={phone} onChangeText={setPhone} placeholder="10-digit number" keyboard="phone-pad" />
          <Field label="Address" value={address} onChangeText={setAddress} placeholder="House and street" multiline />
          <Field label="Area / locality" value={area} onChangeText={setArea} placeholder="Nagpur area" />
          <Field label="PIN code" value={postalCode} onChangeText={setPostalCode} placeholder="6 digits" keyboard="number-pad" />
          <View style={styles.row}><Text>Items at seller price</Text><Text>{formatMoney(itemSubtotal)}</Text></View>
          <View style={styles.row}><Text>Minuto markup (₹5 per item)</Text><Text>{formatMoney(itemMarkup)}</Text></View>
          <View style={styles.row}><Text>Buyer delivery contribution</Text><Text>{formatMoney(buyerDeliveryContribution)}</Text></View>
          <View style={styles.row}><Text>Order total</Text><Text style={styles.cardTitle}>{formatMoney(cartTotal)}</Text></View>
          <Text style={styles.note}>UPI payments are collected into Minuto’s gateway account. Seller payouts are handled separately.</Text>
          <Button title={busy ? "Placing order…" : "Place COD order"} disabled={busy} onPress={() => run(checkout)} />
          {upiAvailable ? <Button
            title={busy ? "Opening checkout…" : pendingPaymentOrderId ? "Retry UPI checkout" : "Pay by UPI"}
            secondary
            disabled={busy}
            onPress={() => run(() => startUpiCheckout(pendingPaymentOrderId ?? undefined))}
          /> : <Text style={styles.note}>UPI checkout will be available after the payment migration is applied in Supabase. COD remains available.</Text>}
        </>}
        {(profile.role === "vendor" && tab === "products") && <>
          <Text style={styles.kicker}>CATALOGUE STUDIO · SELLER</Text>
          <Text style={styles.heading}>Your local listings.</Text>
          <Text style={styles.paragraph}>Make every product feel considered before it reaches a buyer.</Text>
          <View style={styles.sellerListingSummary}><View><Text style={styles.serviceEyebrow}>CATALOGUE HEALTH</Text><Text style={styles.sellerListingSummaryTitle}>{products.filter((product) => product.vendor_id === profile.id && product.active).length} live listings</Text></View><Text style={styles.sellerListingSummaryMark}>✦</Text></View>
          <View style={styles.sellerFormCard}>
            <View style={styles.sellerFormHeader}><Text style={styles.serviceEyebrow}>NEW LISTING</Text><Text style={styles.sellerFormNumber}>01</Text></View>
            <Text style={styles.sellerFormTitle}>Add a local find.</Text>
            <Text style={styles.note}>Clear details help buyers choose with confidence.</Text>
            <Field label="PRODUCT NAME" value={name} onChangeText={setName} placeholder="What are you selling?" />
            <Field label="BUYER-FACING DETAILS" value={details} onChangeText={setDetails} placeholder="Size, freshness, or what makes it special" multiline />
            <Text style={styles.sellerFieldLabel}>CATEGORY</Text>
            <View style={styles.chips}>{categories.map((item) => <Pressable key={item} onPress={() => setCategory(item)} style={[styles.chip, category === item && styles.chipSelected]}><Text>{item}</Text></Pressable>)}</View>
            <View style={styles.sellerSplitFields}><View style={styles.sellerSplitField}><Field label="PRICE (₹)" value={price} onChangeText={setPrice} placeholder="0" keyboard="number-pad" /></View><View style={styles.sellerSplitField}><Field label="STOCK" value={stock} onChangeText={setStock} placeholder="10" keyboard="number-pad" /></View></View>
            <Button title="Choose product photo" secondary onPress={() => run(async () => {
            const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) throw new Error("Allow photo library access.");
            const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.8 });
            if (!result.canceled) setPhoto(result.assets[0]);
            })} />
            {photo ? <Image source={{ uri: photo.uri }} style={styles.preview} /> : <Text style={styles.sellerPhotoHint}>JPG, PNG, or WebP · up to 8 MB</Text>}
            <Button title={busy ? "Publishing…" : "Publish listing →"} disabled={busy} onPress={() => run(addProduct)} />
          </View>
          <Text style={styles.sectionTitle}>Your catalogue</Text>
          {products.filter((item) => item.vendor_id === profile.id).map((product) => {
            const draft = productEdits[product.id] ?? { price: String(product.seller_price), stock: String(product.stock) };
            return <View key={product.id} style={styles.sellerProductCard}>
              <ProductRow product={product} />
              <View style={styles.sellerEditGrid}>
                <View style={styles.sellerEditField}><Field label="PRICE (₹)" value={draft.price} onChangeText={(value) => setProductEdits((current) => ({ ...current, [product.id]: { ...draft, price: value } }))} placeholder="Price" keyboard="number-pad" /></View>
                <View style={styles.sellerEditField}><Field label="STOCK" value={draft.stock} onChangeText={(value) => setProductEdits((current) => ({ ...current, [product.id]: { ...draft, stock: value } }))} placeholder="Stock" keyboard="number-pad" /></View>
              </View>
              <View style={styles.sellerProductFooter}><Text style={[styles.sellerListingStatus, { color: product.active ? "#66816B" : "#9D4438" }]}>{product.active ? "LIVE TO BUYERS" : "PAUSED"}</Text><View style={styles.sellerProductActions}><Button title="Save" secondary disabled={busy} onPress={() => run(() => saveProductInventory(product))} /><Button title={product.active ? "Pause" : "Resume"} secondary disabled={busy} onPress={() => run(() => toggleProduct(product))} /></View></View>
            </View>;
          })}
          <Text style={styles.sectionTitle}>Seller details</Text>
          <View style={styles.sellerSettingsCard}><Text style={styles.serviceEyebrow}>PAYOUT PROFILE</Text><Text style={styles.cardTitle}>Keep your payment details current.</Text><Text style={styles.note}>These details are used by Minuto finance for manual seller payouts and are not independently verified.</Text><Field label="UPI ID" value={sellerUpiId} onChangeText={setSellerUpiId} placeholder="name@bank" keyboard="email-address" /><Field label="MOBILE NUMBER" value={sellerPhone} onChangeText={setSellerPhone} placeholder="10-digit number" keyboard="phone-pad" /><Button title={busy ? "Saving…" : "Save payout details"} secondary disabled={busy} onPress={() => run(saveSellerPaymentDetails)} /><Text style={styles.sellerSettingsDivider}>DELIVERY PROFILE</Text><Text style={styles.cardTitle}>Where should the agent collect orders?</Text><Field label="PICKUP ADDRESS" value={vendorAddress} onChangeText={setVendorAddress} placeholder="Shop name, street, area, Nagpur" multiline /><Button title={busy ? "Saving…" : "Save pickup address"} secondary disabled={busy} onPress={() => run(saveSellerPickupAddress)} /></View>
        </>}
        {profile.role === "vendor" && tab === "orders" && <>
          <Text style={styles.kicker}>OPERATIONS · SELLER</Text>
          <Text style={styles.heading}>Orders & earnings.</Text>
          <Text style={styles.paragraph}>Prepare each order with care. Your payout record stays visible below.</Text>
          <View style={styles.sellerOrderSummary}><View><Text style={styles.serviceEyebrow}>PENDING DELIVERY</Text><Text style={styles.sellerOrderSummaryTitle}>{orders.filter((job) => job.vendor_id === profile.id && !["delivered", "cancelled"].includes(job.status)).length} orders need attention</Text></View><Text style={styles.sellerOrderSummaryIcon}>→</Text></View>
          <View style={styles.sellerOrderFilters}>{(["active", "history"] as const).map((filter) => <Pressable key={filter} onPress={() => setSellerOrderFilter(filter)} style={[styles.sellerOrderFilter, sellerOrderFilter === filter && styles.sellerOrderFilterActive]}><Text style={[styles.sellerOrderFilterText, sellerOrderFilter === filter && styles.sellerOrderFilterTextActive]}>{filter === "active" ? `Needs attention · ${sellerOrders.filter((job) => !["delivered", "cancelled"].includes(job.status)).length}` : `History · ${sellerOrders.filter((job) => ["delivered", "cancelled"].includes(job.status)).length}`}</Text></Pressable>)}</View>
          <Text style={styles.sectionTitle}>{sellerOrderFilter === "active" ? "Prepare local orders" : "Order history"}</Text>
          {visibleSellerOrders.map((job) => <View key={job.id} style={styles.sellerJobCard}><View style={styles.sellerJobTop}><Text style={styles.sellerJobStatus}>{job.status.replaceAll("_", " ").toUpperCase()}</Text><Text style={styles.note}>{job.buyer_area}</Text></View><Text style={styles.cardTitle}>{job.buyer_name || "Buyer order"}</Text><Text style={styles.note}>Deliver to: {job.buyer_address}, {job.buyer_area} · {job.buyer_phone}</Text><Text style={styles.sellerPickupLine}>Collect from: {vendorAddress.trim() || "Pickup address not saved"}</Text><Text style={styles.sellerJobReference}>Order {job.order_id}</Text>{job.status === "new" ? <Button title="Mark ready for pickup →" disabled={busy} onPress={() => run(() => { if (vendorAddress.trim().length < 5) throw new Error("Save a valid pickup address before preparing this order."); return updateJob(job, "ready"); })} /> : <Text style={styles.sellerJobHint}>{job.status === "delivered" ? "Delivered to buyer" : job.status === "cancelled" ? "Order cancelled" : "Pickup is in progress with the delivery team."}</Text>}</View>)}
          {visibleSellerOrders.length === 0 ? <View style={styles.sellerEmpty}><Text style={styles.cardTitle}>{sellerOrderFilter === "active" ? "Your queue is clear" : "No order history yet"}</Text><Text style={styles.note}>{sellerOrderFilter === "active" ? "New buyer orders will appear here with pickup details." : "Completed and cancelled orders will be kept here for reference."}</Text></View> : null}
          <Text style={styles.sectionTitle}>Payout desk</Text>
          <View style={styles.sellerPayoutSummary}><Text style={styles.serviceEyebrow}>MANUAL PAYOUTS</Text><Text style={styles.sellerPayoutTotal}>{formatMoney(sellerPayouts.filter((payout) => payout.status === "pending").reduce((sum, payout) => sum + payout.amount, 0))}</Text><Text style={styles.note}>Pending transfer · Seller price less the ₹6 delivery contribution.</Text></View>
          {sellerPayouts.map((payout) => <View key={payout.id} style={styles.sellerPayoutRow}><View style={styles.grow}><Text style={styles.cardTitle}>{formatMoney(payout.amount)}</Text><Text style={styles.note}>Order {payout.order_id} · {payout.status === "paid" ? "Paid" : payout.status === "not_due" ? "No payout due" : "Awaiting transfer"}</Text></View><Text style={styles.sellerPayoutBadge}>{payout.status === "paid" ? "PAID" : payout.status === "pending" ? "PENDING" : "N/A"}</Text></View>)}
        </>}
        {profile.role === "agent" && tab === "jobs" && <>
          <Text style={styles.kicker}>DELIVERY DESK · NAGPUR</Text>
          <Text style={styles.heading}>Nearby delivery offers</Text>
          <Text style={styles.paragraph}>Accept a route, confirm the pickup, and directions will open automatically for the buyer drop-off.</Text>
          {orders.map((job) => <View key={job.id}><JobCard job={job} role="agent" busy={busy} onAction={() => run(async () => {
            if (job.status === "offered") {
              await takeJob(job);
              return;
            }
            if (job.status === "accepted") {
              await updateJob(job, "picked_up");
              await openAddress(job, "picked_up");
              return;
            }
            setProofJobId(job.id);
          })} onNavigate={() => run(() => openAddress(job, job.status === "accepted" ? "accepted" : "picked_up"))} /><RouteMapCard pickup={job.vendor_address || "Pickup address not provided"} destination={`${job.buyer_address}, ${job.buyer_area}, Nagpur ${job.buyer_postal_code}`} pickupCoordinate={typeof job.vendor_latitude === "number" && typeof job.vendor_longitude === "number" ? [job.vendor_longitude, job.vendor_latitude] : undefined} destinationCoordinate={typeof job.buyer_latitude === "number" && typeof job.buyer_longitude === "number" ? [job.buyer_longitude, job.buyer_latitude] : undefined} agentCoordinate={job.agent_id && agentLocations[job.agent_id] ? [agentLocations[job.agent_id].longitude, agentLocations[job.agent_id].latitude] : undefined} status={job.status} onOpenDirections={() => run(() => openAddress(job, job.status === "accepted" ? "accepted" : "picked_up"))} />{proofJobId === job.id ? <View style={styles.proofCard}><Text style={styles.serviceEyebrow}>PROOF OF DELIVERY</Text><Text style={styles.cardTitle}>Close this handoff securely.</Text><Text style={styles.note}>Ask the buyer for the 4-digit delivery code before handing over the order.</Text><Field label="BUYER DELIVERY CODE" value={proofOtp} onChangeText={setProofOtp} placeholder="4 digits" keyboard="number-pad" /><Field label="DELIVERY NOTE (OPTIONAL)" value={proofNote} onChangeText={setProofNote} placeholder="Left with the buyer at the door" multiline /><Button title={proofPhoto ? "Replace proof photo" : "Add proof photo"} secondary onPress={() => run(chooseProofPhoto)} /><Text style={styles.note}>{proofPhoto ? `Photo ready · ${proofPhoto.fileName ?? "delivery-proof"}` : "A photo is optional. Avoid capturing sensitive personal information."}</Text><Button title="Confirm delivered" disabled={busy} onPress={() => run(() => submitDeliveryProof(job))} /><Button title="Cancel" secondary onPress={() => { setProofJobId(null); setProofPhoto(null); }} /></View> : null}</View>)}
        </>}
        {profile.role === "buyer" && tab === "deliveries" && <>
          <Text style={styles.heading}>Your orders</Text>
          {buyerOrders.map((order) => <View key={order.id} style={styles.jobCard}>
            <Text style={styles.cardTitle}>Order · {formatMoney(order.total)}</Text>
            <Text style={styles.note}>
              {order.payment_method === "cod" ? "Cash on delivery" : `UPI · ${order.payment_status.replaceAll("_", " ")}`}
            </Text>
            {order.payment_review_required
              ? <Text style={styles.noticeText}>Payment needs manual review. Contact Minuto support and quote this order ID: {order.id}</Text>
              : null}
            {order.payment_utr ? <Text style={styles.note}>Bank reference: {order.payment_utr}</Text> : null}
            {order.payment_method === "upi" && order.payment_status === "pending" &&
              <>
                <Button title="Continue UPI payment" disabled={busy} onPress={() => run(() => startUpiCheckout(order.id))} />
                <Button title="Refresh payment status" secondary disabled={busy} onPress={() => run(() => syncUpiPayment(order.id))} />
              </>}
            {order.payment_method === "upi" && ["failed", "expired", "cancelled"].includes(order.payment_status) &&
              <Button title="Retry UPI payment" disabled={busy} onPress={() => run(() => startUpiCheckout(order.id))} />}
          </View>)}
          <Text style={styles.heading}>Your deliveries</Text>
          {orders.map((job) => <View key={job.id}><JobCard job={job} role="buyer" busy={busy} onAction={() => Promise.resolve()} onNavigate={() => run(() => openAddress(job))} />{!["delivered", "cancelled"].includes(job.status) ? <View style={styles.deliveryCodeCard}><Text style={styles.serviceEyebrow}>HANDOFF CODE</Text><Text style={styles.note}>Share this code with the agent only when you receive your order.</Text>{deliveryOtps[job.id] ? <Text selectable style={styles.deliveryCode}>{deliveryOtps[job.id]}</Text> : <Button title="Reveal delivery code" secondary disabled={busy} onPress={() => run(() => showDeliveryOtp(job))} />}</View> : null}</View>)}
        </>}
        {!products.length && profile.role !== "vendor" && <Text style={styles.paragraph}>Local vendors will add the first listings soon.</Text>}
      </ScrollView>
      <View style={styles.bottomBar}>{tabs.map(([key, title]) => <Pressable key={key} onPress={() => setTab(key as typeof tab)}><Text style={[styles.tab, tab === key && styles.tabActive]}>{title}</Text></Pressable>)}</View>
    </SafeAreaView>
  );
}

function ProductRow({
  product,
  quantity,
  saved,
  onAdd,
  onFavorite,
}: {
  product: Product;
  quantity?: number;
  saved?: boolean;
  onAdd?: () => void;
  onFavorite?: () => void;
}) {
  return (
    <View style={styles.productRow}>
      {product.image_url ? <Image source={{ uri: product.image_url }} style={styles.productImage} /> : <View style={styles.productImage} />}
      <View style={styles.grow}><Text style={styles.cardTitle}>{product.name}</Text><Text style={styles.note}>{product.vendor_name} · {product.details}</Text><Text>{formatMoney(product.seller_price + 5)} · {product.stock} available</Text></View>
      {onFavorite ? <Pressable accessibilityRole="button" accessibilityLabel={saved ? "Remove saved product" : "Save product"} onPress={onFavorite} style={styles.link}><Text>{saved ? "♥" : "♡"}</Text></Pressable> : null}
      {onAdd ? <Pressable onPress={onAdd} style={styles.add}><Text style={styles.buttonText}>{quantity ? `+${quantity}` : "+ Add"}</Text></Pressable> : null}
    </View>
  );
}

function JobCard({
  job,
  role,
  busy,
  onAction,
  onNavigate,
}: {
  job: DeliveryJob;
  role: Role;
  busy: boolean;
  onAction: () => void | Promise<void>;
  onNavigate: () => void;
}) {
  const status = job.status.replaceAll("_", " ");
  return (
    <View style={styles.jobCard}>
      <Text style={styles.cardTitle}>{job.vendor_name} delivery · {status}</Text>
      <Text style={styles.paragraph}>Pickup: {job.vendor_address || "Vendor is adding pickup address"}</Text>
      <Text style={styles.paragraph}>Drop-off: {job.buyer_address}, {job.buyer_area}, Nagpur {job.buyer_postal_code}</Text>
      {job.distance_km == null
        ? <Text style={styles.note}>Distance payout will be shown after route distance is configured.</Text>
        : <Text style={styles.note}>Estimated agent earnings: {formatMoney(job.agent_payout ?? 0)} · {job.distance_km} km</Text>}
      {role === "agent" && job.status === "offered" && <Button title={busy ? "Accepting…" : "Accept delivery"} disabled={busy} onPress={onAction} />}
      {role === "agent" && ["accepted", "picked_up"].includes(job.status) && <>
        <Button title="Open destination in Maps" secondary onPress={onNavigate} />
        <Button title={job.status === "accepted" ? "Picked up" : "Delivered"} disabled={busy} onPress={onAction} />
      </>}
      {role === "vendor" && job.status === "new" && <Button title={busy ? "Updating…" : "Ready for pickup"} disabled={busy} onPress={onAction} />}
    </View>
  );
}

function Root() {
  const [client, setClient] = useState(supabaseClient);
  const [configLoading, setConfigLoading] = useState(!supabaseClient);
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [passwordRecovery, setPasswordRecovery] = useState(() =>
    Platform.OS === "web" && typeof window !== "undefined"
      && (window.location.hash.includes("type=recovery") || window.location.search.includes("type=recovery")),
  );
  useEffect(() => {
    if (supabaseClient) return;
    let active = true;
    void AsyncStorage.getItem(BACKEND_CONFIG_KEY).then((stored) => {
      if (!active || !stored) return;
      const parsed: unknown = JSON.parse(stored);
      if (
        typeof parsed === "object" && parsed !== null &&
        "url" in parsed && typeof parsed.url === "string" &&
        "key" in parsed && typeof parsed.key === "string"
      ) {
        const config = validateSupabaseConfig(parsed.url, parsed.key);
        setClient(makeSupabaseClient(config.url, config.key));
      } else {
        throw new Error("Saved backend settings are invalid. Reconnect your project.");
      }
    }).catch((error: unknown) => {
      if (active) Alert.alert("Backend setup error", messageFor(error));
    }).finally(() => {
      if (active) setConfigLoading(false);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!client) return;
    let active = true;
    const { data: listener } = client.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
      setSession(nextSession);
    });
    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) Alert.alert("Session error", error.message);
      setSession(data.session);
      setSessionLoading(false);
    }).catch((error: unknown) => {
      if (active) {
        Alert.alert("Session error", messageFor(error));
        setSessionLoading(false);
      }
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [client]);
  if (agentPreviewEnabled) return <DeliveryAgentPreviewScreen />;
  if (configLoading || (client && sessionLoading)) return <LoadingScreen label="Starting Minuto…" />;
  if (!client) {
    return <SetupScreen onConnect={async (rawUrl, rawKey) => {
      const config = validateSupabaseConfig(rawUrl, rawKey);
      await AsyncStorage.setItem(BACKEND_CONFIG_KEY, JSON.stringify(config));
      setClient(makeSupabaseClient(config.url, config.key));
    }} />;
  }
  if (passwordRecovery && session) {
    return <PasswordResetScreen client={client} onComplete={() => setPasswordRecovery(false)} />;
  }
  return session ? <AppContent key={session.user.id} client={client} session={session} /> : <AuthScreen client={client} />;
}

export default function App() {
  return <AppErrorBoundary><SafeAreaProvider><Root /></SafeAreaProvider></AppErrorBoundary>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: palette.background },
  center: { flex: 1, justifyContent: "center", padding: 24 },
  authScroll: { flexGrow: 1, justifyContent: "center", padding: 24, paddingBottom: 48 },
  content: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 36 },
  brand: { color: palette.ink, fontSize: 22, fontWeight: "800", letterSpacing: -0.8 },
  heading: { color: palette.ink, fontSize: 30, fontWeight: "600", letterSpacing: -1, marginTop: 18, marginBottom: 12 },
  kicker: { color: palette.muted, fontSize: 10, fontWeight: "800", letterSpacing: 1.5, marginTop: 26 },
  paragraph: { color: palette.muted, fontSize: 13, lineHeight: 20, marginTop: 8 },
  note: { color: palette.muted, fontSize: 11, lineHeight: 17, marginTop: 6 },
  field: { gap: 7, marginTop: 15 },
  fieldLabel: { color: palette.ink, fontSize: 12, fontWeight: "700" },
  input: { backgroundColor: palette.white, borderColor: palette.line, borderRadius: 10, borderWidth: 1, color: palette.ink, fontSize: 14, minHeight: 48, paddingHorizontal: 13 },
  multiline: { minHeight: 80, paddingTop: 12, textAlignVertical: "top" },
  button: { alignItems: "center", backgroundColor: palette.green, borderRadius: 10, justifyContent: "center", marginTop: 14, minHeight: 48, paddingHorizontal: 14 },
  buttonSecondary: { backgroundColor: palette.soft },
  buttonText: { color: palette.white, fontSize: 13, fontWeight: "700" },
  buttonTextSecondary: { color: palette.green },
  disabled: { opacity: 0.55 },
  link: { color: palette.green, fontSize: 13, fontWeight: "700", padding: 12 },
  error: { color: palette.error, fontSize: 12, marginTop: 12 },
  topBar: { alignItems: "center", borderBottomColor: palette.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 66, paddingHorizontal: 18 },
  adminTopActions: { alignItems: "center", flexDirection: "row" },
  adminProfilePill: { backgroundColor: palette.soft, borderRadius: 16, marginRight: 4, paddingHorizontal: 9, paddingVertical: 6 },
  adminProfileText: { color: palette.green, fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  adminSafe: { backgroundColor: "#FFFFFF" },
  adminContent: { paddingHorizontal: 28, paddingTop: 18, paddingBottom: 54 },
  adminTopBar: { backgroundColor: "#FFFFFF", borderBottomColor: "#F0EEE9", paddingHorizontal: 28 },
  adminHero: { borderRadius: 2, height: 310, justifyContent: "center", marginTop: 26, overflow: "hidden" },
  adminHeroImage: { opacity: 0.92 },
  adminHeroShade: { backgroundColor: "rgba(255,255,255,0.62)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  adminHeroContent: { alignItems: "center", paddingHorizontal: 20, paddingVertical: 34 },
  adminHeroTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  adminEyebrow: { color: "#111111" },
  adminLive: { color: "#6F6D66", fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  adminHeroTitle: { color: "#111111", fontFamily: "PlayfairDisplay_400Regular", fontSize: 38, fontWeight: "400", letterSpacing: -1.8, lineHeight: 42, marginTop: 20, textAlign: "center" },
  adminHeroText: { color: "#5E5C56", fontFamily: "Manrope_400Regular", fontSize: 13, lineHeight: 19, marginTop: 16, maxWidth: 430, textAlign: "center" },
  adminStats: { backgroundColor: "#FFFFFF", borderBottomColor: "#111111", borderTopColor: "#111111", borderBottomWidth: 1, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 4, paddingVertical: 18 },
  adminStat: { alignItems: "center", borderRightColor: palette.line, borderRightWidth: 1, flex: 1, paddingHorizontal: 5 },
  adminStatDot: { borderRadius: 4, height: 7, marginBottom: 7, width: 7 },
  adminStatDotAmber: { backgroundColor: "#D39A35" },
  adminStatDotGreen: { backgroundColor: "#6F9270" },
  adminStatDotRed: { backgroundColor: "#C96C5D" },
  adminStatDotBlue: { backgroundColor: "#7398B2" },
  adminStatValue: { color: "#111111", fontSize: 24, fontWeight: "500" },
  adminStatLabel: { color: "#111111", fontSize: 10, marginTop: 5, textAlign: "center" },
  adminStatHint: { color: "#8A8880", fontSize: 9, marginTop: 4, textAlign: "center" },
  adminNav: { gap: 8, justifyContent: "center", paddingVertical: 22 },
  adminNavItem: { backgroundColor: "#FFFFFF", borderColor: "#BDBBB4", borderRadius: 22, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10 },
  adminNavItemActive: { backgroundColor: "#111111", borderColor: "#111111" },
  adminNavText: { color: "#3C3B37", fontFamily: "Manrope_600SemiBold", fontSize: 12, fontWeight: "600" },
  adminNavTextActive: { color: palette.white },
  adminToolbar: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  adminSectionHeader: { alignItems: "center", borderBottomColor: "#D9D6CF", borderBottomWidth: 1, flexDirection: "row", gap: 12, marginTop: 8, paddingBottom: 16 },
  adminSectionIcon: { alignItems: "center", backgroundColor: "#111111", borderRadius: 24, height: 42, justifyContent: "center", width: 42 },
  adminSectionIconText: { color: "#FFFFFF", fontSize: 18, fontWeight: "800" },
  adminSectionTitle: { color: "#111111", fontSize: 20, fontWeight: "500", letterSpacing: -0.3 },
  adminActions: { gap: 8, marginTop: 4 },
  adminWelcome: { marginTop: 2 },
  adminPriority: { backgroundColor: "#F4F2ED", borderRadius: 2, marginTop: 20, padding: 20 },
  adminQuickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  adminQuickCard: { backgroundColor: "#FFFFFF", borderColor: "#D9D6CF", borderRadius: 2, borderWidth: 1, minHeight: 122, padding: 16, width: "48%" },
  adminQuickIcon: { color: "#111111", fontSize: 22, fontWeight: "700", marginBottom: 10 },
  adminQuickTop: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  adminQuickArrow: { color: palette.muted, fontSize: 16 },
  trustSummary: { backgroundColor: "#F4F2ED", borderRadius: 2, marginTop: 16, padding: 18 },
  inviteCodeCard: { backgroundColor: "#111111", borderRadius: 2, marginTop: 16, padding: 18 },
  inviteCode: { color: "#FFFFFF", fontSize: 28, fontWeight: "600", letterSpacing: 3, marginTop: 12 },
  emptyState: { borderColor: "#D9D6CF", borderRadius: 2, borderWidth: 1, marginTop: 12, padding: 18 },
  financeSummary: { backgroundColor: "#111111", borderRadius: 2, marginTop: 16, padding: 20 },
  financeSummaryTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  financeStatus: { color: "#D5E7D0", fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  financeTitle: { color: "#FFFFFF", fontSize: 24, fontWeight: "400", letterSpacing: -0.7, lineHeight: 29, marginTop: 18 },
  financeMetrics: { borderTopColor: "#454545", borderTopWidth: 1, flexDirection: "row", gap: 34, marginTop: 20, paddingTop: 16 },
  financeMetricValue: { color: "#FFFFFF", fontSize: 20, fontWeight: "500" },
  financeMetricLabel: { color: "#B5B5B0", fontSize: 10, marginTop: 4 },
  financeCount: { color: palette.muted, fontSize: 14, fontWeight: "500" },
  financeRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  financeBadge: { backgroundColor: "#F2E8C9", color: "#846B25", fontSize: 9, fontWeight: "800", letterSpacing: 0.8, paddingHorizontal: 8, paddingVertical: 5 },
  financeBadgeDanger: { backgroundColor: "#F3DDD8", color: "#9D4438", fontSize: 9, fontWeight: "800", letterSpacing: 0.8, paddingHorizontal: 8, paddingVertical: 5 },
  auditSummary: { backgroundColor: "#111111", borderRadius: 2, marginTop: 16, padding: 22 },
  auditSummaryTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  auditLive: { color: "#B8D1BC", fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  auditTitle: { color: "#FFFFFF", fontFamily: "PlayfairDisplay_400Regular", fontSize: 27, fontWeight: "400", letterSpacing: -0.8, lineHeight: 32, marginTop: 20 },
  auditIntro: { color: "#B5B5B0", fontFamily: "Manrope_400Regular", fontSize: 12, lineHeight: 18, marginTop: 9, maxWidth: 430 },
  auditMetrics: { borderTopColor: "#454545", borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 22, paddingTop: 16 },
  auditMetricValue: { color: "#FFFFFF", fontSize: 21, fontWeight: "500" },
  auditMetricLabel: { color: "#A8A8A1", fontSize: 10, marginTop: 4 },
  auditFilterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 18 },
  auditFilter: { backgroundColor: "#FFFFFF", borderColor: "#D0CDC5", borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9 },
  auditFilterActive: { backgroundColor: "#111111", borderColor: "#111111" },
  auditFilterText: { color: "#57554F", fontSize: 11, fontWeight: "700" },
  auditFilterTextActive: { color: "#FFFFFF" },
  auditTimelineList: { marginTop: 20 },
  auditEvent: { flexDirection: "row", minHeight: 132 },
  auditRail: { alignItems: "center", marginRight: 14, width: 16 },
  auditDot: { borderColor: "#FFFFFF", borderRadius: 8, borderWidth: 3, height: 14, width: 14 },
  auditLine: { backgroundColor: "#D9D6CF", flex: 1, marginVertical: 4, width: 1 },
  auditEventBody: { backgroundColor: "#F7F5F0", borderColor: "#E2DED5", borderWidth: 1, flex: 1, marginBottom: 12, padding: 16 },
  auditEventTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  auditGroup: { fontSize: 9, fontWeight: "800", letterSpacing: 1.3 },
  auditTime: { color: "#8A8880", fontSize: 10 },
  auditEventTitle: { color: "#111111", fontFamily: "Manrope_600SemiBold", fontSize: 16, fontWeight: "600", marginTop: 12 },
  auditEventDetail: { color: "#68665F", fontFamily: "Manrope_400Regular", fontSize: 11, lineHeight: 17, marginTop: 5 },
  auditReference: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E2DED5", borderWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 14, paddingHorizontal: 10, paddingVertical: 8 },
  auditReferenceLabel: { color: "#8A8880", fontSize: 8, fontWeight: "800", letterSpacing: 1 },
  auditReferenceValue: { color: "#292A24", flex: 1, fontFamily: Platform.OS === "web" ? "monospace" : undefined, fontSize: 10, marginHorizontal: 9 },
  auditEventIcon: { color: "#77766D", fontSize: 14, fontWeight: "700" },
  auditEmpty: { alignItems: "center", borderColor: "#D9D6CF", borderWidth: 1, marginTop: 20, padding: 28 },
  auditEmptyMark: { color: "#77766D", fontSize: 25, marginBottom: 8 },
  sellerHero: { backgroundColor: "#445442", borderRadius: 2, marginTop: 18, padding: 22 },
  sellerHeroTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sellerLive: { color: "#D5E7D0", fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  sellerHeroTitle: { color: "#FFFFFF", fontFamily: "PlayfairDisplay_400Regular", fontSize: 29, lineHeight: 34, marginTop: 20 },
  sellerHeroText: { color: "#D6DED3", fontFamily: "Manrope_400Regular", fontSize: 12, lineHeight: 18, marginTop: 10, maxWidth: 420 },
  sellerMetricGrid: { borderBottomColor: "#D9D6CF", borderBottomWidth: 1, borderTopColor: "#D9D6CF", borderTopWidth: 1, flexDirection: "row", marginTop: 14, paddingVertical: 17 },
  agentMetricGrid: { borderBottomColor: "#D9D6CF", borderBottomWidth: 1, borderTopColor: "#D9D6CF", borderTopWidth: 1, flexDirection: "row", marginTop: 14, paddingVertical: 17 },
  sellerMetric: { borderRightColor: "#E4E0D8", borderRightWidth: 1, flex: 1, paddingHorizontal: 10 },
  sellerMetricValue: { color: "#111111", fontFamily: "Manrope_600SemiBold", fontSize: 20 },
  sellerMetricLabel: { color: "#77766D", fontFamily: "Manrope_400Regular", fontSize: 10, marginTop: 4 },
  sellerSnapshot: { backgroundColor: "#F4F2ED", borderColor: "#D9D6CF", borderWidth: 1, marginTop: 14, padding: 16 },
  sellerSnapshotGrid: { borderTopColor: "#D9D6CF", borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 14, paddingTop: 14 },
  sellerSnapshotValue: { color: "#111111", fontFamily: "Manrope_600SemiBold", fontSize: 18 },
  sellerSnapshotLabel: { color: "#77766D", fontFamily: "Manrope_400Regular", fontSize: 9, marginTop: 4 },
  sellerActionGrid: { flexDirection: "row", gap: 10, marginTop: 18 },
  sellerActionCard: { backgroundColor: "#F4F2ED", borderColor: "#D9D6CF", borderWidth: 1, flex: 1, minHeight: 116, padding: 15 },
  sellerActionIcon: { color: "#445442", fontSize: 23, fontWeight: "500", marginBottom: 11 },
  sellerSectionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginTop: 25 },
  sellerOrderRow: { alignItems: "center", borderBottomColor: "#E7E3DA", borderBottomWidth: 1, flexDirection: "row", paddingVertical: 14 },
  sellerStatusDot: { backgroundColor: "#C4933B", borderRadius: 5, height: 9, marginRight: 12, width: 9 },
  sellerOrderArrow: { color: "#77766D", fontSize: 22, paddingHorizontal: 6 },
  sellerEmpty: { backgroundColor: "#F7F5F0", borderColor: "#E2DED5", borderWidth: 1, marginTop: 12, padding: 16 },
  sellerLowStockCard: { backgroundColor: "#FBF8EF", borderColor: "#E3D6B6", borderWidth: 1, marginTop: 13, padding: 16 },
  sellerLowStockHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sellerLowStockCount: { backgroundColor: "#E8E0C6", color: "#846B25", fontFamily: "Manrope_700Bold", fontSize: 11, paddingHorizontal: 9, paddingVertical: 5 },
  sellerLowStockRow: { alignItems: "center", borderTopColor: "#E9DEC5", borderTopWidth: 1, flexDirection: "row", marginTop: 12, paddingTop: 12 },
  sellerStockBadge: { fontFamily: "Manrope_700Bold", fontSize: 9, letterSpacing: 1 },
  sellerHealthyCard: { alignItems: "center", backgroundColor: "#F1F6F0", borderColor: "#D7E4D5", borderWidth: 1, flexDirection: "row", marginTop: 13, padding: 16 },
  sellerHealthyMark: { color: "#66816B", fontSize: 22, marginRight: 13 },
  sellerProductCard: { backgroundColor: "#F7F5F0", borderColor: "#E2DED5", borderWidth: 1, marginTop: 14, padding: 10 },
  sellerEditGrid: { flexDirection: "row", gap: 10 },
  sellerEditField: { flex: 1 },
  sellerProductFooter: { alignItems: "center", borderTopColor: "#E2DED5", borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 4, paddingTop: 8 },
  sellerProductActions: { flexDirection: "row", gap: 6 },
  sellerListingStatus: { fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  sellerListingSummary: { alignItems: "center", backgroundColor: "#111111", flexDirection: "row", justifyContent: "space-between", marginTop: 18, padding: 20 },
  sellerListingSummaryTitle: { color: "#FFFFFF", fontFamily: "PlayfairDisplay_400Regular", fontSize: 25, marginTop: 8 },
  sellerListingSummaryMark: { color: "#D5E7D0", fontSize: 28 },
  sellerFormCard: { backgroundColor: "#F4F2ED", borderColor: "#D9D6CF", borderWidth: 1, marginTop: 16, padding: 20 },
  sellerFormHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sellerFormNumber: { color: "#77766D", fontFamily: "Manrope_600SemiBold", fontSize: 11, letterSpacing: 1 },
  sellerFormTitle: { color: "#111111", fontFamily: "PlayfairDisplay_400Regular", fontSize: 26, marginTop: 14 },
  sellerFieldLabel: { color: "#77766D", fontFamily: "Manrope_700Bold", fontSize: 10, letterSpacing: 1.3, marginTop: 20 },
  sellerSplitFields: { flexDirection: "row", gap: 12 },
  sellerSplitField: { flex: 1 },
  sellerPhotoHint: { color: "#77766D", fontFamily: "Manrope_400Regular", fontSize: 10, marginTop: 12 },
  sellerSettingsCard: { backgroundColor: "#F7F5F0", borderColor: "#E2DED5", borderWidth: 1, marginTop: 12, padding: 18 },
  sellerSettingsDivider: { borderTopColor: "#E2DED5", borderTopWidth: 1, color: "#77766D", fontFamily: "Manrope_700Bold", fontSize: 10, letterSpacing: 1.3, marginTop: 22, paddingTop: 18 },
  sellerOrderSummary: { alignItems: "center", backgroundColor: "#445442", flexDirection: "row", justifyContent: "space-between", marginTop: 18, padding: 20 },
  sellerOrderSummaryTitle: { color: "#FFFFFF", fontFamily: "PlayfairDisplay_400Regular", fontSize: 24, marginTop: 8 },
  sellerOrderSummaryIcon: { color: "#D5E7D0", fontSize: 28 },
  sellerOrderFilters: { flexDirection: "row", gap: 8, marginTop: 18 },
  sellerOrderFilter: { backgroundColor: "#FFFFFF", borderColor: "#D0CDC5", borderRadius: 20, borderWidth: 1, flex: 1, paddingHorizontal: 10, paddingVertical: 10 },
  sellerOrderFilterActive: { backgroundColor: "#111111", borderColor: "#111111" },
  sellerOrderFilterText: { color: "#57554F", fontFamily: "Manrope_600SemiBold", fontSize: 10, textAlign: "center" },
  sellerOrderFilterTextActive: { color: "#FFFFFF" },
  sellerJobCard: { backgroundColor: "#F7F5F0", borderColor: "#E2DED5", borderWidth: 1, marginTop: 13, padding: 17 },
  sellerJobTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sellerJobStatus: { color: "#B18A39", fontFamily: "Manrope_700Bold", fontSize: 9, letterSpacing: 1 },
  sellerJobReference: { color: "#8A8880", fontFamily: Platform.OS === "web" ? "monospace" : undefined, fontSize: 10, marginTop: 12 },
  sellerPickupLine: { color: "#445442", fontFamily: "Manrope_600SemiBold", fontSize: 11, lineHeight: 17, marginTop: 12 },
  sellerJobHint: { color: "#66816B", fontFamily: "Manrope_600SemiBold", fontSize: 11, marginTop: 15 },
  sellerPayoutSummary: { backgroundColor: "#111111", marginTop: 12, padding: 18 },
  sellerPayoutTotal: { color: "#FFFFFF", fontFamily: "PlayfairDisplay_400Regular", fontSize: 30, marginTop: 8 },
  sellerPayoutRow: { alignItems: "center", borderBottomColor: "#E7E3DA", borderBottomWidth: 1, flexDirection: "row", paddingVertical: 14 },
  sellerPayoutBadge: { backgroundColor: "#E8E0C6", color: "#846B25", fontFamily: "Manrope_700Bold", fontSize: 9, letterSpacing: 1, paddingHorizontal: 8, paddingVertical: 6 },
  previewBanner: { backgroundColor: "#F2E8C9", paddingHorizontal: 18, paddingVertical: 7 },
  previewBannerText: { color: "#846B25", fontFamily: "Manrope_700Bold", fontSize: 9, letterSpacing: 1, textAlign: "center" },
  previewMode: { color: "#846B25", fontFamily: "Manrope_700Bold", fontSize: 9, letterSpacing: 1 },
  agentHero: { backgroundColor: "#445442", borderRadius: 2, marginTop: 18, padding: 22 },
  agentHeroTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  agentHeroTitle: { color: "#FFFFFF", fontFamily: "PlayfairDisplay_400Regular", fontSize: 29, lineHeight: 34, marginTop: 20 },
  agentHeroText: { color: "#D6DED3", fontFamily: "Manrope_400Regular", fontSize: 12, lineHeight: 18, marginTop: 10 },
  agentNextCard: { backgroundColor: "#111111", marginTop: 18, padding: 20 },
  agentNextTitle: { color: "#FFFFFF", fontFamily: "PlayfairDisplay_400Regular", fontSize: 24, marginTop: 12 },
  agentRoute: { color: "#D5E7D0", fontFamily: "Manrope_600SemiBold", fontSize: 11, marginTop: 12 },
  agentSteps: { borderColor: "#E2DED5", borderWidth: 1, marginTop: 12, paddingHorizontal: 16 },
  agentStep: { borderBottomColor: "#E2DED5", borderBottomWidth: 1, color: "#57554F", fontFamily: "Manrope_500Medium", fontSize: 11, paddingVertical: 14 },
  agentJobCard: { backgroundColor: "#F7F5F0", borderColor: "#E2DED5", borderWidth: 1, marginTop: 14, padding: 17 },
  proofCard: { backgroundColor: "#FFFDF8", borderColor: "#B18A39", borderWidth: 1, marginTop: 14, padding: 16 },
  deliveryCodeCard: { backgroundColor: "#F7F5F0", borderColor: "#D9D6CF", borderWidth: 1, marginTop: 10, padding: 15 },
  deliveryCode: { color: "#445442", fontFamily: "Manrope_700Bold", fontSize: 30, letterSpacing: 8, marginVertical: 12 },
  routeMapCard: { backgroundColor: "#FFFFFF", borderColor: "#D9D6CF", borderWidth: 1, marginTop: 14, padding: 14 },
  routeMapHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  routeMapTitle: { color: "#111111", fontFamily: "PlayfairDisplay_400Regular", fontSize: 19, marginTop: 6 },
  routeMapCompass: { alignItems: "center", borderColor: "#D9D6CF", borderRadius: 16, borderWidth: 1, color: "#445442", fontFamily: "Manrope_700Bold", fontSize: 10, padding: 8 },
  routeMapCanvas: { backgroundColor: "#E9EFE9", height: 150, marginTop: 14, overflow: "hidden", position: "relative" },
  routeMapRoadOne: { backgroundColor: "#FFFFFF", height: 12, left: -20, position: "absolute", top: 54, transform: [{ rotate: "19deg" }], width: "120%" },
  routeMapRoadTwo: { backgroundColor: "#FFFFFF", height: 9, left: -20, position: "absolute", top: 98, transform: [{ rotate: "-24deg" }], width: "120%" },
  routeMapRoadThree: { backgroundColor: "#D4E0D3", height: 4, left: -20, position: "absolute", top: 28, transform: [{ rotate: "-8deg" }], width: "120%" },
  routeMapRouteLine: { borderColor: "#445442", borderRadius: 40, borderRightWidth: 3, borderTopWidth: 3, height: 75, left: "28%", position: "absolute", top: 40, transform: [{ rotate: "17deg" }], width: "44%" },
  routeMapPin: { alignItems: "center", borderColor: "#FFFFFF", borderRadius: 13, borderWidth: 3, height: 26, justifyContent: "center", position: "absolute", width: 26, zIndex: 2 },
  routeMapPickup: { backgroundColor: "#B18A39", left: "18%", top: 31 },
  routeMapDropoff: { backgroundColor: "#9D4438", right: "17%", top: 95 },
  routeMapPinText: { color: "#FFFFFF", fontFamily: "Manrope_700Bold", fontSize: 9 },
  routeMapMapLabel: { backgroundColor: "rgba(255,255,255,0.75)", bottom: 10, left: 10, paddingHorizontal: 8, paddingVertical: 5, position: "absolute" },
  routeMapMapLabelText: { color: "#445442", fontFamily: "Manrope_700Bold", fontSize: 8, letterSpacing: 1 },
  routeMapAddresses: { gap: 10, marginTop: 14 },
  routeMapAddressRow: { alignItems: "center", flexDirection: "row" },
  routeMapDot: { borderRadius: 4, height: 8, marginRight: 9, width: 8 },
  routeMapDotPickup: { backgroundColor: "#B18A39" },
  routeMapDotDropoff: { backgroundColor: "#9D4438" },
  routeMapLabel: { color: "#8A8880", fontFamily: "Manrope_700Bold", fontSize: 8, letterSpacing: 1 },
  routeMapAddress: { color: "#57554F", fontFamily: "Manrope_500Medium", fontSize: 11, marginTop: 2 },
  agentPayout: { color: "#66816B", fontFamily: "Manrope_700Bold", fontSize: 12 },
  agentLocation: { color: "#57554F", fontFamily: "Manrope_600SemiBold", fontSize: 11, lineHeight: 18, marginTop: 12 },
  agentEarningsCard: { backgroundColor: "#111111", marginTop: 18, padding: 20 },
  agentEarningsTotal: { color: "#FFFFFF", fontFamily: "PlayfairDisplay_400Regular", fontSize: 34, marginTop: 10 },
  agentEarningRow: { alignItems: "center", borderBottomColor: "#E7E3DA", borderBottomWidth: 1, flexDirection: "row", paddingVertical: 15 },
  agentBottomBar: { backgroundColor: "#FFFFFF", borderTopColor: "#E7E3DA", borderTopWidth: 1, flexDirection: "row", justifyContent: "space-around", paddingBottom: 12, paddingTop: 12 },
  servicesSummary: { backgroundColor: "#445442", borderRadius: 2, marginTop: 16, padding: 20 },
  servicesMetrics: { borderTopColor: "#687764", borderTopWidth: 1, flexDirection: "row", gap: 34, marginTop: 20, paddingTop: 16 },
  providerBrief: { backgroundColor: "#F4F2ED", borderColor: "#D9D6CF", borderWidth: 1, marginTop: 20, padding: 20 },
  providerBriefHeader: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  providerBriefKicker: { color: "#77756D", fontSize: 10, fontWeight: "800", letterSpacing: 1.4 },
  providerBriefTitle: { color: "#111111", fontSize: 25, fontWeight: "500", letterSpacing: -0.7, marginTop: 8 },
  providerBriefMark: { color: "#445442", fontSize: 28 },
  providerBriefText: { color: "#68665F", fontSize: 12, lineHeight: 18, marginTop: 8, maxWidth: 420 },
  providerBriefLabel: { borderBottomColor: "#D0CDC5", borderBottomWidth: 1, color: "#77756D", fontSize: 10, fontWeight: "800", letterSpacing: 1.3, marginTop: 24, paddingBottom: 8 },
  serviceTypeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  serviceTypeCard: { backgroundColor: "#FFFFFF", borderColor: "#D9D6CF", borderWidth: 1, minHeight: 94, padding: 12, width: "48%" },
  serviceTypeCardSelected: { backgroundColor: "#111111", borderColor: "#111111" },
  serviceTypeIcon: { color: "#445442", fontSize: 18, fontWeight: "700" },
  serviceTypeIconSelected: { color: "#FFFFFF" },
  serviceTypeTitle: { color: "#111111", fontSize: 13, fontWeight: "700", marginTop: 10 },
  serviceTypeSubtitle: { color: "#77756D", fontSize: 10, marginTop: 3 },
  providerTypeCardSelected: { color: "#FFFFFF" },
  providerField: { marginTop: 14 },
  providerFieldHalf: { flex: 1 },
  providerFieldLabel: { color: "#44423D", fontSize: 11, fontWeight: "700", marginBottom: 6 },
  providerInput: { backgroundColor: "#FFFFFF", borderColor: "#D2CFC7", borderWidth: 1, color: "#111111", fontSize: 13, minHeight: 45, paddingHorizontal: 12 },
  providerInputMultiline: { minHeight: 72, paddingTop: 12, textAlignVertical: "top" },
  providerSplit: { flexDirection: "row", gap: 10 },
  providerSettings: { borderTopColor: "#D0CDC5", borderTopWidth: 1, marginTop: 20 },
  providerSetting: { alignItems: "center", borderBottomColor: "#D0CDC5", borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 12 },
  providerSettingTitle: { color: "#22211E", fontSize: 12, fontWeight: "700" },
  providerSettingNote: { color: "#77756D", fontSize: 10, marginTop: 3 },
  providerSettingValue: { color: "#445442", fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  providerPublishButton: { alignItems: "center", backgroundColor: "#111111", justifyContent: "center", marginTop: 20, minHeight: 52, paddingHorizontal: 16 },
  providerPublishText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700", letterSpacing: 0.2 },
  notice: { backgroundColor: "#F3E9DD", marginHorizontal: 14, marginTop: 8, padding: 10 },
  noticeText: { color: palette.error, fontSize: 12, lineHeight: 18, marginTop: 8 },
  notificationShelf: { backgroundColor: "#111111", marginBottom: 18, padding: 16 },
  notificationShelfTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  notificationCount: { color: "#B8D1BC", fontFamily: "Manrope_700Bold", fontSize: 10 },
  notificationRow: { alignItems: "flex-start", borderTopColor: "#454545", borderTopWidth: 1, flexDirection: "row", gap: 10, marginTop: 13, paddingTop: 13 },
  notificationUnread: { borderLeftColor: "#B18A39", borderLeftWidth: 2, paddingLeft: 8 },
  notificationDot: { backgroundColor: "#B18A39", borderRadius: 4, height: 7, marginTop: 5, width: 7 },
  notificationTitle: { color: "#FFFFFF", fontFamily: "Manrope_600SemiBold", fontSize: 12 },
  notificationBody: { color: "#B5B5B0", fontFamily: "Manrope_400Regular", fontSize: 11, lineHeight: 16, marginTop: 3 },
  notificationTime: { color: "#8A8880", fontSize: 9 },
  bottomBar: { alignItems: "center", borderTopColor: palette.line, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-around", paddingVertical: 14 },
  tab: { color: palette.muted, fontSize: 12, padding: 6 },
  tabActive: { color: palette.green, fontWeight: "800" },
  roleCard: { backgroundColor: palette.white, borderColor: palette.line, borderRadius: 12, borderWidth: 1, marginTop: 10, padding: 14 },
  roleCardSelected: { borderColor: palette.green, borderWidth: 2 },
  cardTitle: { color: palette.ink, fontSize: 14, fontWeight: "700" },
  productRow: { alignItems: "center", backgroundColor: palette.white, borderRadius: 12, flexDirection: "row", gap: 12, marginTop: 12, padding: 10 },
  productImage: { backgroundColor: palette.soft, borderRadius: 8, height: 66, width: 66 },
  grow: { flex: 1 },
  add: { backgroundColor: palette.green, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  row: { alignItems: "center", borderBottomColor: palette.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 12 },
  chips: { flexDirection: "row", gap: 8, marginTop: 8 },
  chip: { borderColor: palette.line, borderRadius: 18, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  chipSelected: { backgroundColor: palette.soft, borderColor: palette.green },
  ratingChip: { backgroundColor: palette.soft, borderColor: palette.line, borderRadius: 18, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 8 },
  ratingChipSelected: { backgroundColor: "#DCE7D7", borderColor: palette.green },
  serviceHighlight: { backgroundColor: palette.green, borderRadius: 16, marginTop: 18, padding: 18 },
  serviceEyebrow: { color: "#C8D5C1", fontSize: 10, fontWeight: "800", letterSpacing: 1.4 },
  serviceHighlightTitle: { color: palette.white, fontSize: 24, fontWeight: "700", letterSpacing: -0.7, marginTop: 10 },
  serviceHighlightText: { color: "#E3E9DF", fontSize: 13, lineHeight: 20, marginTop: 8 },
  serviceCard: { backgroundColor: palette.white, borderColor: palette.line, borderRadius: 14, borderWidth: 1, marginTop: 12, padding: 15 },
  serviceCardTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
  serviceCategory: { color: palette.green, fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  serviceMeta: { color: palette.muted, fontSize: 11 },
  serviceFooter: { alignItems: "center", borderTopColor: palette.line, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 14, paddingTop: 12 },
  serviceAction: { color: palette.green, fontSize: 12, fontWeight: "800" },
  serviceDetail: { backgroundColor: palette.white, borderColor: palette.line, borderRadius: 16, borderWidth: 1, marginTop: 14, padding: 18 },
  providerCard: { backgroundColor: palette.soft, borderColor: palette.line, borderRadius: 12, borderWidth: 1, marginTop: 10, padding: 12 },
  providerSelected: { borderColor: palette.green, borderWidth: 2 },
  addressCard: { backgroundColor: palette.white, borderColor: palette.line, borderRadius: 10, borderWidth: 1, marginTop: 8, padding: 11 },
  toggleRow: { alignItems: "center", borderBottomColor: palette.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", marginTop: 12, paddingVertical: 6 },
  providerAdminCard: { backgroundColor: palette.white, borderColor: palette.line, borderRadius: 12, borderWidth: 1, marginTop: 10, padding: 12 },
  searchPanel: { backgroundColor: palette.white, borderColor: palette.line, borderRadius: 12, borderWidth: 1, marginTop: 10, padding: 12 },
  searchResult: { borderBottomColor: palette.line, borderBottomWidth: 1, paddingVertical: 11 },
  homeCard: { backgroundColor: palette.green, borderRadius: 16, marginTop: 18, padding: 18 },
  homeCardHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  homeBadge: { backgroundColor: "#63745F", borderRadius: 12, color: palette.white, fontSize: 9, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 5 },
  homeCardTitle: { color: palette.white, fontSize: 22, fontWeight: "700", letterSpacing: -0.5, marginTop: 14 },
  sectionTitle: { color: palette.ink, fontSize: 17, fontWeight: "700", marginTop: 24 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 10 },
  quickAction: { backgroundColor: palette.white, borderColor: palette.line, borderRadius: 12, borderWidth: 1, minHeight: 92, padding: 13, width: "48%" },
  quickActionTitle: { color: palette.ink, fontSize: 13, fontWeight: "700" },
  menuList: { backgroundColor: palette.white, borderColor: palette.line, borderRadius: 16, borderWidth: 1, marginTop: 10, overflow: "hidden" },
  menuRow: { alignItems: "center", borderBottomColor: palette.line, borderBottomWidth: 1, flexDirection: "row", gap: 12, minHeight: 70, paddingHorizontal: 14 },
  menuIcon: { alignItems: "center", backgroundColor: palette.soft, borderRadius: 20, height: 38, justifyContent: "center", width: 38 },
  menuIconText: { color: palette.green, fontSize: 16, fontWeight: "800" },
  menuArrow: { color: palette.green, fontSize: 24, fontWeight: "300" },
  timelineCard: { backgroundColor: palette.white, borderColor: palette.line, borderRadius: 14, borderWidth: 1, marginTop: 10, padding: 15 },
  activitySummary: { backgroundColor: palette.soft, borderRadius: 14, flexDirection: "row", justifyContent: "space-between", marginTop: 16, padding: 16 },
  rewardPoints: { color: palette.green, fontSize: 22, fontWeight: "800", marginTop: 5 },
  reminderRow: { alignItems: "center", backgroundColor: palette.white, borderBottomColor: palette.line, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingVertical: 14 },
  reminderCheck: { color: palette.green, fontSize: 22, fontWeight: "700", paddingLeft: 12 },
  deleteText: { color: palette.error, fontSize: 22, paddingLeft: 12 },
  completedText: { color: palette.muted, textDecorationLine: "line-through" },
  preview: { alignSelf: "center", borderRadius: 10, height: 170, marginTop: 12, width: 170 },
  jobCard: { backgroundColor: palette.white, borderColor: palette.line, borderRadius: 12, borderWidth: 1, marginTop: 12, padding: 14 },
});
