import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type Session } from "@supabase/supabase-js";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Alert,
  Image,
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

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
const BACKEND_CONFIG_KEY = "minuto-supabase-config-v1";

function makeSupabaseClient(url: string, key: string) {
  return createClient(url, key, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
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
  marketplace_approval_status: "pending" | "approved" | "rejected";
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
  created_at: string;
};
type PendingApplicant = {
  id: string;
  display_name: string;
  email: string;
  role: "vendor" | "agent";
  marketplace_approval_status: "pending";
  seller_upi_id: string | null;
  seller_phone: string | null;
  created_at: string;
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

function formatMoney(amount: number) {
  return `₹${Math.round(amount).toLocaleString("en-IN")}`;
}

function messageFor(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
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
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        accessibilityLabel={props.label}
        autoCapitalize={props.keyboard === "email-address" ? "none" : "sentences"}
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

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
            options: { data: { display_name: name.trim() } },
          })
        : await client.auth.signInWithPassword({ email: normalizedEmail, password });
      if (result.error) throw result.error;
      if (creating && !result.data.session) {
        setError("Check your email to confirm your account, then sign in.");
      }
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
          <Text style={styles.kicker}>LOCAL VENDORS · NAGPUR</Text>
          <Text style={styles.heading}>{creating ? "A good place to begin." : "Welcome back."}</Text>
          {creating && <Field label="Your name" value={name} onChangeText={setName} placeholder="Name" />}
          <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboard="email-address" />
          <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secure />
          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          <Button title={busy ? "Please wait…" : creating ? "Create account" : "Sign in"} onPress={() => void submit()} disabled={busy} />
          <Pressable onPress={() => { setCreating(!creating); setError(""); }}>
            <Text style={styles.link}>{creating ? "Already registered? Sign in" : "New to Minuto? Create an account"}</Text>
          </Pressable>
          <Text style={styles.note}>Vendor and delivery-agent accounts require review before they can use marketplace features.</Text>
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
  onDone: (name: string, role: Role) => Promise<void>;
}) {
  const [name, setName] = useState(profile.display_name);
  const [role, setRole] = useState<Role>("buyer");
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
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          title={busy ? "Saving…" : "Continue"}
          disabled={busy}
          onPress={() => {
            setBusy(true);
            void onDone(name, role).catch((reason: unknown) => setError(messageFor(reason))).finally(() => setBusy(false));
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

  const loadProfile = useCallback(async () => {
    const [profileResult, adminResult] = await Promise.all([
      client.from("profiles")
        .select("id, display_name, email, role, marketplace_approval_status, marketplace_approval_note, pickup_address, seller_upi_id, seller_phone")
        .eq("id", session.user.id)
        .maybeSingle(),
      client.rpc("is_finance_admin"),
    ]);
    if (profileResult.error) throw profileResult.error;
    if (adminResult.error) throw adminResult.error;
    if (profileResult.data) setProfile(profileResult.data as Profile);
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
          setNotice(`Could not load your account: ${messageFor(error)}`);
          setLoading(false);
        }
      }
    }
    void loadAccount();
    return () => { active = false; };
  }, [loadProfile]);

  async function saveRole(name: string, role: Role) {
    const normalizedName = name.trim();
    if (normalizedName.length < 2 || normalizedName.length > 60) throw new Error("Enter a name between 2 and 60 characters.");
    const { error } = await client.rpc("choose_market_role", { p_role: role, p_display_name: normalizedName });
    if (error) throw error;
    setProfile((current) => current ? {
      ...current,
      display_name: normalizedName,
      role,
      marketplace_approval_status: role === "buyer" ? "approved" : "pending",
    } : null);
  }

  async function saveVendorPaymentDetails(upiId: string, phone: string) {
    const normalizedUpiId = upiId.trim();
    const normalizedPhone = phone.replace(/\D/g, "");
    if (!/^[A-Z0-9][A-Z0-9._+-]{1,63}@[A-Z0-9][A-Z0-9.-]{1,63}$/i.test(normalizedUpiId)) {
      throw new Error("Enter a valid UPI ID, such as name@bank.");
    }
    if (!/^[6-9]\d{9}$/.test(normalizedPhone)) {
      throw new Error("Enter a valid 10-digit Indian mobile number.");
    }
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
  if (!profile) return <AuthScreen client={client} />;
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
  const [applicants, setApplicants] = useState<PendingApplicant[]>([]);
  const [payouts, setPayouts] = useState<FinancePayout[]>([]);
  const [cases, setCases] = useState<ReconciliationCase[]>([]);
  const [auditEntries, setAuditEntries] = useState<FinanceAuditEntry[]>([]);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [transferReferences, setTransferReferences] = useState<Record<string, string>>({});
  const [refundNotes, setRefundNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    const [applicantResult, payoutResult, caseResult, auditResult] = await Promise.all([
      client.from("profiles")
        .select("id,display_name,email,role,marketplace_approval_status,seller_upi_id,seller_phone,created_at")
        .eq("marketplace_approval_status", "pending")
        .in("role", ["vendor", "agent"])
        .order("created_at", { ascending: true })
        .limit(100),
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
    ]);
    const firstError = applicantResult.error ?? payoutResult.error ?? caseResult.error ?? auditResult.error;
    if (firstError) throw firstError;
    setApplicants((applicantResult.data ?? []) as PendingApplicant[]);
    setPayouts((payoutResult.data ?? []) as FinancePayout[]);
    setCases((caseResult.data ?? []) as ReconciliationCase[]);
    setAuditEntries((auditResult.data ?? []) as FinanceAuditEntry[]);
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

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <View style={styles.topBar}>
        <View><Text style={styles.brand}>minuto</Text><Text style={styles.note}>Finance administration</Text></View>
        <Pressable onPress={() => run(onSignOut)}><Text style={styles.link}>Sign out</Text></Pressable>
      </View>
      {notice ? <Pressable accessibilityRole="alert" onPress={() => setNotice("")} style={styles.notice}><Text style={styles.paragraph}>{notice}</Text></Pressable> : null}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.note}>Admin access is allowlisted and requires a confirmed account email. Record only actions already completed outside this app.</Text>
        <Button title={busy ? "Refreshing…" : "Refresh finance records"} secondary disabled={busy} onPress={() => run(async () => {})} />

        <Text style={styles.heading}>Account approvals</Text>
        {applicants.length === 0 ? <Text style={styles.paragraph}>No marketplace accounts are waiting for review.</Text> : null}
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
          <Button title={busy ? "Saving…" : "Approve account"} disabled={busy} onPress={() => run(async () => {
            const { error } = await client.rpc("review_marketplace_account", {
              p_user_id: applicant.id,
              p_decision: "approved",
              p_note: reviewNotes[applicant.id] ?? "",
            });
            if (error) throw error;
            setReviewNotes((current) => ({ ...current, [applicant.id]: "" }));
          })} />
          <Button title={busy ? "Saving…" : "Reject account"} secondary disabled={busy} onPress={() => run(async () => {
            const { error } = await client.rpc("review_marketplace_account", {
              p_user_id: applicant.id,
              p_decision: "rejected",
              p_note: reviewNotes[applicant.id] ?? "",
            });
            if (error) throw error;
            setReviewNotes((current) => ({ ...current, [applicant.id]: "" }));
          })} />
        </View>)}

        <Text style={styles.heading}>Seller payouts</Text>
        <Text style={styles.note}>Transfer funds first. Record the bank reference only after the transfer has completed.</Text>
        {payouts.length === 0 ? <Text style={styles.paragraph}>No seller payouts are pending.</Text> : null}
        {payouts.map((payout) => <View key={payout.id} style={styles.jobCard}>
          <Text style={styles.cardTitle}>{formatMoney(payout.amount)} · seller payout</Text>
          <Text style={styles.note}>Seller {payout.vendor_id} · order {payout.order_id}</Text>
          <Text style={styles.note}>Pay to {payout.seller_upi_id} · {payout.seller_phone}</Text>
          <Field
            label="Completed bank transfer reference"
            value={transferReferences[payout.id] ?? ""}
            onChangeText={(value) => setTransferReferences((current) => ({ ...current, [payout.id]: value }))}
            placeholder="Bank / UPI transaction reference"
          />
          <Button title={busy ? "Recording…" : "Record completed transfer"} disabled={busy} onPress={() => run(async () => {
            const { error } = await client.rpc("record_seller_payout", {
              p_payout_id: payout.id,
              p_transfer_reference: transferReferences[payout.id] ?? "",
            });
            if (error) throw error;
            setTransferReferences((current) => ({ ...current, [payout.id]: "" }));
          })} />
        </View>)}

        <Text style={styles.heading}>Payment exceptions</Text>
        <Text style={styles.note}>Refund the captured payment through the payment provider or bank first. This action only records the completed refund and its reference.</Text>
        {cases.length === 0 ? <Text style={styles.paragraph}>No payment exceptions are open.</Text> : null}
        {cases.map((paymentCase) => <View key={paymentCase.payment_id} style={styles.jobCard}>
          <Text style={styles.cardTitle}>Order {paymentCase.order_id}</Text>
          <Text style={styles.note}>Payment {paymentCase.payment_id} · {formatMoney(paymentCase.amount_paise / 100)}</Text>
          <Text style={styles.paragraph}>{paymentCase.reason}</Text>
          <Field
            label="Completed refund reference and note"
            value={refundNotes[paymentCase.payment_id] ?? ""}
            onChangeText={(value) => setRefundNotes((current) => ({ ...current, [paymentCase.payment_id]: value }))}
            placeholder="Refund transaction reference and outcome"
            multiline
          />
          <Button title={busy ? "Recording…" : "Record completed refund"} disabled={busy} onPress={() => run(async () => {
            const { error } = await client.rpc("resolve_payment_reconciliation", {
              p_payment_id: paymentCase.payment_id,
              p_resolution_status: "refunded",
              p_resolution_note: refundNotes[paymentCase.payment_id] ?? "",
            });
            if (error) throw error;
            setRefundNotes((current) => ({ ...current, [paymentCase.payment_id]: "" }));
          })} />
        </View>)}

        <Text style={styles.heading}>Recent admin actions</Text>
        {auditEntries.length === 0 ? <Text style={styles.paragraph}>No finance actions recorded yet.</Text> : null}
        {auditEntries.map((entry) => <Text key={entry.id} style={styles.note}>
          {entry.action.replaceAll("_", " ")} · {entry.entity_id} · {new Date(entry.created_at).toLocaleString()}
        </Text>)}
      </ScrollView>
    </SafeAreaView>
  );
}

function LoadingScreen({ label }: { label: string }) {
  return <View style={styles.center}><ActivityIndicator color={palette.green} /><Text style={styles.paragraph}>{label}</Text></View>;
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
  const [buyerOrders, setBuyerOrders] = useState<BuyerOrder[]>([]);
  const [sellerPayouts, setSellerPayouts] = useState<SellerPayout[]>([]);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [cart, setCart] = useState<Cart>({});
  const [pendingPaymentOrderId, setPendingPaymentOrderId] = useState<string | null>(null);
  const [tab, setTab] = useState<"shop" | "cart" | "deliveries" | "orders" | "products" | "jobs">(
    profile.role === "vendor" ? "products" : profile.role === "agent" ? "jobs" : "shop",
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
  const [search, setSearch] = useState("");

  const refresh = useCallback(async () => {
    const [productResult, jobResult, favoriteResult] = await Promise.all([
      client.from("products").select("*").eq("active", true).order("created_at", { ascending: false }),
      profile.role === "agent"
        ? client.from("delivery_jobs").select("*").in("status", ["offered", "accepted", "picked_up"]).order("created_at", { ascending: false })
        : profile.role === "vendor"
          ? client.from("delivery_jobs").select("*").eq("vendor_id", profile.id).order("created_at", { ascending: false })
          : client.from("delivery_jobs").select("*").eq("buyer_id", profile.id).order("created_at", { ascending: false }),
      profile.role === "buyer"
        ? client.from("favorites").select("product_id").eq("user_id", profile.id)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (productResult.error) throw productResult.error;
    if (jobResult.error) throw jobResult.error;
    if (favoriteResult.error) throw favoriteResult.error;
    let buyerOrderData: BuyerOrder[] = [];
    let sellerPayoutData: SellerPayout[] = [];
    if (profile.role === "buyer") {
      const { data, error } = await client.from("orders")
        .select("id,total,payment_method,payment_status,payment_review_required,payment_utr,created_at")
        .eq("buyer_id", profile.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      buyerOrderData = (data ?? []) as BuyerOrder[];
    } else if (profile.role === "vendor") {
      const { data, error } = await client.from("seller_payouts")
        .select("id,order_id,gross_amount,delivery_contribution,amount,status,transfer_reference,created_at")
        .eq("vendor_id", profile.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      sellerPayoutData = (data ?? []) as SellerPayout[];
    }
    setProducts((productResult.data ?? []) as Product[]);
    setOrders((jobResult.data ?? []) as DeliveryJob[]);
    setFavorites((favoriteResult.data ?? []).map((favorite: { product_id: string }) => favorite.product_id));
    setBuyerOrders(buyerOrderData);
    setSellerPayouts(sellerPayoutData);
  }, [client, profile.id, profile.role]);

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

  function validateDeliveryDetails() {
    if (!cartLines.length) throw new Error("Add products to your bag first.");
    if (!/^[6-9]\d{9}$/.test(phone.replace(/\D/g, ""))) throw new Error("Enter a valid 10-digit Indian mobile number.");
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

  async function updateJob(job: DeliveryJob, status: "ready" | "picked_up" | "delivered") {
    if (status === "ready") {
      const { error } = await client.rpc("prepare_delivery_job", {
        p_job_id: job.id,
        p_pickup_address: vendorAddress.trim(),
      });
      if (error) throw error;
    } else {
      const { error } = await client.rpc("advance_delivery_job", { p_job_id: job.id, p_status: status });
      if (error) throw error;
    }
    try {
      await refresh();
    } catch (refreshError: unknown) {
      setNotice(`Delivery status updated, but the screen could not refresh: ${messageFor(refreshError)}`);
    }
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

  async function openAddress(job: DeliveryJob) {
    const destination = job.status === "accepted" ? job.vendor_address : `${job.buyer_address}, ${job.buyer_area}, Nagpur ${job.buyer_postal_code}`;
    if (!destination.trim()) throw new Error("The address is missing; contact support before traveling.");
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
    const supported = await Linking.canOpenURL(url);
    if (!supported) throw new Error("Could not open Maps on this device.");
    await Linking.openURL(url);
  }

  function run(action: () => Promise<unknown>) {
    setBusy(true);
    void action().catch((error: unknown) => setNotice(messageFor(error))).finally(() => setBusy(false));
  }

  const tabs = profile.role === "buyer"
    ? [["shop", "Shop"], ["cart", `Bag · ${Object.values(cart).reduce((a, b) => a + b, 0)}`], ["deliveries", "Deliveries"]]
    : profile.role === "vendor"
      ? [["products", "Listings"], ["orders", "Orders"]]
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
        {profile.role === "buyer" && tab === "shop" && <>
          <Text style={styles.kicker}>LOCAL FINDS · NAGPUR</Text><Text style={styles.heading}>Good things, close by.</Text>
          <Field label="Search vendors and products" value={search} onChangeText={setSearch} placeholder="Search…" />
          {visibleProducts.map((product) => <ProductRow key={product.id} product={product} quantity={cart[product.id] ?? 0} saved={favorites.includes(product.id)} onFavorite={() => run(() => toggleFavorite(product))} onAdd={product.stock > 0 ? () => setCart((current) => ({ ...current, [product.id]: Math.min(99, product.stock, (current[product.id] ?? 0) + 1) })) : undefined} />)}
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
          <Button
            title={busy ? "Opening checkout…" : pendingPaymentOrderId ? "Retry UPI checkout" : "Pay by UPI"}
            secondary
            disabled={busy}
            onPress={() => run(() => startUpiCheckout(pendingPaymentOrderId ?? undefined))}
          />
        </>}
        {(profile.role === "vendor" && tab === "products") && <>
          <Text style={styles.heading}>Your local listings</Text>
          <Text style={styles.fieldLabel}>Seller payment details · not independently verified</Text>
          <Field label="Your UPI ID" value={sellerUpiId} onChangeText={setSellerUpiId} placeholder="name@bank" keyboard="email-address" />
          <Field label="Mobile number" value={sellerPhone} onChangeText={setSellerPhone} placeholder="10-digit number" keyboard="phone-pad" />
          <Text style={styles.note}>Buyer UPI payments go to Minuto’s configured gateway account. Minuto pays sellers separately; saving these details does not make the gateway pay you automatically.</Text>
          <Button title={busy ? "Saving…" : "Save seller payment details"} secondary disabled={busy} onPress={() => run(saveSellerPaymentDetails)} />
          <Field label="Vendor pickup address" value={vendorAddress} onChangeText={setVendorAddress} placeholder="Enter pickup address" multiline />
          <Field label="Product name" value={name} onChangeText={setName} placeholder="What are you selling?" />
          <Field label="Details" value={details} onChangeText={setDetails} placeholder="Size or description" />
          <Text style={styles.fieldLabel}>Category</Text>
          <View style={styles.chips}>{categories.map((item) => <Pressable key={item} onPress={() => setCategory(item)} style={[styles.chip, category === item && styles.chipSelected]}><Text>{item}</Text></Pressable>)}</View>
          <Field label="Your price (₹)" value={price} onChangeText={setPrice} placeholder="0" keyboard="number-pad" />
          <Field label="Stock" value={stock} onChangeText={setStock} placeholder="10" keyboard="number-pad" />
          <Button title="Choose product photo" secondary onPress={() => run(async () => {
            const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) throw new Error("Allow photo library access.");
            const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, quality: 0.8 });
            if (!result.canceled) setPhoto(result.assets[0]);
          })} />
          {photo ? <Image source={{ uri: photo.uri }} style={styles.preview} /> : null}
          <Button title={busy ? "Publishing…" : "Publish listing"} disabled={busy} onPress={() => run(addProduct)} />
          {products.filter((item) => item.vendor_id === profile.id).map((product) => <ProductRow key={product.id} product={product} />)}
        </>}
        {profile.role === "vendor" && tab === "orders" && <>
          <Text style={styles.heading}>Seller payouts</Text>
          <Text style={styles.note}>Payouts are manual. Net payout is seller-price total less the existing ₹6 seller delivery contribution for each vendor order. Amounts at or below ₹6 have no payout due. Contact Minuto support if a transfer is overdue.</Text>
          {sellerPayouts.map((payout) => <View key={payout.id} style={styles.jobCard}>
            <Text style={styles.cardTitle}>{formatMoney(payout.amount)} · {payout.status === "paid" ? "Paid" : payout.status === "not_due" ? "No payout due" : "Awaiting transfer"}</Text>
            <Text style={styles.note}>Seller total {formatMoney(payout.gross_amount)} · delivery contribution {formatMoney(payout.delivery_contribution)}</Text>
            <Text style={styles.note}>Order {payout.order_id}</Text>
            {payout.transfer_reference ? <Text style={styles.note}>Transfer reference: {payout.transfer_reference}</Text> : null}
          </View>)}
          <Text style={styles.heading}>Prepare local orders</Text>
          {orders.filter((job) => job.vendor_id === profile.id).map((job) => <JobCard key={job.id} job={job} role="vendor" busy={busy} onAction={() => run(() => updateJob(job, "ready"))} onNavigate={() => run(() => openAddress(job))} />)}
        </>}
        {profile.role === "agent" && tab === "jobs" && <>
          <Text style={styles.heading}>Nearby delivery offers</Text>
          <Text style={styles.note}>Offers update live while the app is open. Background push alerts are not configured yet.</Text>
          {orders.map((job) => <JobCard key={job.id} job={job} role="agent" busy={busy} onAction={() => run(() => job.status === "offered" ? takeJob(job) : updateJob(job, job.status === "accepted" ? "picked_up" : "delivered"))} onNavigate={() => run(() => openAddress(job))} />)}
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
          {orders.map((job) => <JobCard key={job.id} job={job} role="buyer" busy={busy} onAction={() => Promise.resolve()} onNavigate={() => run(() => openAddress(job))} />)}
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
        setClient(makeSupabaseClient(parsed.url, parsed.key));
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
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [client]);
  if (configLoading || (client && sessionLoading)) return <LoadingScreen label="Starting Minuto…" />;
  if (!client) {
    return <SetupScreen onConnect={async (rawUrl, rawKey) => {
      const url = rawUrl.trim().replace(/\/+$/, "");
      const key = rawKey.trim();
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        throw new Error("Enter a valid Supabase project URL.");
      }
      if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname.endsWith(".supabase.co")) {
        throw new Error("Enter an HTTPS Supabase project URL ending in .supabase.co.");
      }
      if (!(key.startsWith("sb_publishable_") || key.startsWith("eyJ"))) {
        throw new Error("Enter a Supabase publishable/anon key, not a secret key.");
      }
      await AsyncStorage.setItem(BACKEND_CONFIG_KEY, JSON.stringify({ url, key }));
      setClient(makeSupabaseClient(url, key));
    }} />;
  }
  return session ? <AppContent key={session.user.id} client={client} session={session} /> : <AuthScreen client={client} />;
}

export default function App() {
  return <SafeAreaProvider><Root /></SafeAreaProvider>;
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
  notice: { backgroundColor: "#F3E9DD", marginHorizontal: 14, marginTop: 8, padding: 10 },
  noticeText: { color: palette.error, fontSize: 12, lineHeight: 18, marginTop: 8 },
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
  preview: { alignSelf: "center", borderRadius: 10, height: 170, marginTop: 12, width: 170 },
  jobCard: { backgroundColor: palette.white, borderColor: palette.line, borderRadius: 12, borderWidth: 1, marginTop: 12, padding: 14 },
});
