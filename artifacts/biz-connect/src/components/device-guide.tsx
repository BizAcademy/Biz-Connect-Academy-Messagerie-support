import type { ReactNode } from "react";
import { isIos } from "@/lib/browser-push";

export type GuideDevice = "ios" | "android" | "desktop";
export type GuideTopic = "install" | "notify-ios" | "notify-denied" | "notify-unsupported";

export function detectDevice(): GuideDevice {
  if (typeof navigator === "undefined") return "desktop";
  if (isIos()) return "ios";
  if (/android/i.test(navigator.userAgent)) return "android";
  return "desktop";
}

const P = "hsl(var(--primary))";
const MUTED = "hsl(var(--muted-foreground))";
const CARD = "hsl(var(--card))";
const BORDER = "hsl(var(--border))";

function Badge({ x, y, n }: { x: number; y: number; n: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r={11} fill={P} stroke={CARD} strokeWidth={2.5} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill="hsl(var(--primary-foreground))">{n}</text>
    </g>
  );
}

function Ring({ x, y, w, h, r = 8 }: { x: number; y: number; w: number; h: number; r?: number }) {
  return <rect x={x} y={y} width={w} height={h} rx={r} fill="none" stroke={P} strokeWidth={2.5} strokeDasharray="5 3" />;
}

function Phone({ children, label }: { children: ReactNode; label: string }) {
  return (
    <svg viewBox="0 0 160 300" role="img" aria-label={label} className="h-auto w-full max-w-[150px]">
      <rect x={4} y={4} width={152} height={292} rx={24} fill="hsl(var(--foreground) / 0.85)" />
      <rect x={10} y={10} width={140} height={280} rx={19} fill={CARD} />
      <rect x={58} y={15} width={44} height={8} rx={4} fill="hsl(var(--foreground) / 0.85)" />
      {children}
    </svg>
  );
}

function Lines({ y }: { y: number }) {
  return (
    <g fill="hsl(var(--muted))">
      <rect x={22} y={y} width={116} height={8} rx={4} />
      <rect x={22} y={y + 14} width={90} height={8} rx={4} />
      <rect x={22} y={y + 28} width={104} height={8} rx={4} />
    </g>
  );
}

function ShareIcon({ x, y }: { x: number; y: number }) {
  return (
    <g stroke={P} strokeWidth={1.8} fill="none" strokeLinecap="round">
      <path d={`M${x - 6} ${y - 2} h-2 v12 h16 v-12 h-2`} />
      <path d={`M${x} ${y + 4} v-12 M${x - 4} ${y - 4} l4 -4 l4 4`} />
    </g>
  );
}

/* ---------- iOS install ---------- */
function IosStep1() {
  return (
    <Phone label="Illustration : Safari, bouton Partager en bas">
      <rect x={22} y={34} width={116} height={16} rx={8} fill="hsl(var(--muted))" />
      <text x={80} y={45} textAnchor="middle" fontSize={8} fill={MUTED}>bca-messenger</text>
      <Lines y={66} />
      <rect x={10} y={250} width={140} height={40} fill="hsl(var(--muted) / 0.6)" />
      {[30, 55, 105, 130].map((x) => <circle key={x} cx={x} cy={268} r={4} fill={MUTED} opacity={0.5} />)}
      <ShareIcon x={80} y={266} />
      <Ring x={66} y={252} w={28} h={30} />
      <Badge x={98} y={244} n={1} />
    </Phone>
  );
}
function IosStep2() {
  return (
    <Phone label="Illustration : menu Partager, option Sur l’écran d’accueil">
      <rect x={10} y={110} width={140} height={180} rx={14} fill="hsl(var(--muted))" />
      {["Copier", "Ajouter aux favoris", "Sur l’écran d’accueil", "Imprimer"].map((t, i) => (
        <g key={t}>
          <rect x={18} y={124 + i * 36} width={124} height={28} rx={7} fill={CARD} />
          <text x={26} y={142 + i * 36} fontSize={8.5} fontWeight={i === 2 ? 700 : 400} fill={i === 2 ? P : MUTED}>{t}</text>
          {i === 2 && <rect x={124} y={130 + i * 36} width={12} height={12} rx={3} fill="none" stroke={P} strokeWidth={1.6} />}
        </g>
      ))}
      <Ring x={15} y={193} w={130} h={34} />
      <Badge x={140} y={190} n={2} />
    </Phone>
  );
}
function IosStep3() {
  return (
    <Phone label="Illustration : bouton Ajouter en haut à droite">
      <text x={22} y={46} fontSize={8} fill={MUTED}>Annuler</text>
      <text x={136} y={46} textAnchor="end" fontSize={9} fontWeight={700} fill={P}>Ajouter</text>
      <Ring x={102} y={34} w={40} h={18} r={6} />
      <Badge x={140} y={30} n={3} />
      <rect x={22} y={66} width={116} height={44} rx={10} fill="hsl(var(--muted))" />
      <rect x={30} y={74} width={28} height={28} rx={7} fill={P} />
      <text x={66} y={92} fontSize={8.5} fill={MUTED}>BCA Messenger</text>
    </Phone>
  );
}
function IosStep4() {
  return (
    <Phone label="Illustration : icône BCA Messenger sur l’écran d’accueil">
      {Array.from({ length: 12 }).map((_, i) => {
        const x = 26 + (i % 4) * 30, y = 44 + Math.floor(i / 4) * 40;
        const me = i === 6;
        return <rect key={i} x={x} y={y} width={22} height={22} rx={6} fill={me ? P : "hsl(var(--muted))"} />;
      })}
      <Ring x={82} y={120} w={30} h={30} />
      <Badge x={114} y={118} n={4} />
      <text x={80} y={190} textAnchor="middle" fontSize={8} fill={MUTED}>Ouvrir depuis l’icône</text>
    </Phone>
  );
}

/* ---------- Android install ---------- */
function AndroidStep1() {
  return (
    <Phone label="Illustration : menu à trois points en haut à droite">
      <rect x={22} y={34} width={96} height={16} rx={8} fill="hsl(var(--muted))" />
      {[36, 42, 48].map((y) => <circle key={y} cx={132} cy={y} r={1.8} fill={P} />)}
      <Ring x={122} y={28} w={20} h={26} r={6} />
      <Badge x={140} y={64} n={1} />
      <Lines y={70} />
    </Phone>
  );
}
function AndroidStep2() {
  return (
    <Phone label="Illustration : option Installer l’application">
      <rect x={52} y={30} width={92} height={150} rx={8} fill={CARD} stroke={BORDER} />
      {["Nouvel onglet", "Favoris", "Installer l’app", "Partager", "Paramètres"].map((t, i) => (
        <text key={t} x={60} y={50 + i * 28} fontSize={8} fontWeight={i === 2 ? 700 : 400} fill={i === 2 ? P : MUTED}>{t}</text>
      ))}
      <Ring x={55} y={93} w={86} h={22} r={6} />
      <Badge x={50} y={92} n={2} />
    </Phone>
  );
}
function AndroidStep3() {
  return (
    <Phone label="Illustration : boîte de confirmation Installer">
      <rect x={20} y={110} width={120} height={80} rx={12} fill={CARD} stroke={BORDER} />
      <text x={30} y={130} fontSize={8.5} fontWeight={700} fill={MUTED}>Installer l’application ?</text>
      <text x={70} y={174} fontSize={8} fill={MUTED}>Annuler</text>
      <text x={130} y={174} textAnchor="end" fontSize={9} fontWeight={700} fill={P}>Installer</text>
      <Ring x={96} y={162} w={40} h={18} r={6} />
      <Badge x={138} y={158} n={3} />
    </Phone>
  );
}

/* ---------- Desktop ---------- */
function DesktopIllustration() {
  return (
    <svg viewBox="0 0 320 190" role="img" aria-label="Illustration : icône d’installation dans la barre d’adresse et menu du navigateur" className="h-auto w-full">
      <rect x={4} y={4} width={312} height={170} rx={10} fill={CARD} stroke={BORDER} strokeWidth={2} />
      <rect x={4} y={4} width={312} height={30} rx={10} fill="hsl(var(--muted))" />
      {[18, 30, 42].map((x) => <circle key={x} cx={x} cy={19} r={4} fill={MUTED} opacity={0.5} />)}
      <rect x={60} y={11} width={200} height={16} rx={8} fill={CARD} />
      <text x={70} y={22} fontSize={8} fill={MUTED}>bca-messenger</text>
      <g stroke={P} strokeWidth={1.6} fill="none"><rect x={238} y={14} width={14} height={10} rx={2} /><path d="M245 16 v6 M242 19 l3 3 l3 -3" /></g>
      <Ring x={232} y={9} w={26} h={20} r={6} />
      <Badge x={240} y={48} n={1} />
      {[14, 19, 24].map((y) => <circle key={y} cx={300} cy={y} r={1.6} fill={P} />)}
      <Ring x={290} y={8} w={20} h={22} r={6} />
      <Badge x={300} y={48} n={2} />
      <rect x={200} y={62} width={110} height={70} rx={6} fill={CARD} stroke={BORDER} />
      <text x={208} y={80} fontSize={8} fill={MUTED}>Nouvel onglet</text>
      <text x={208} y={100} fontSize={8} fontWeight={700} fill={P}>Installer BCA Messenger</text>
      <text x={208} y={120} fontSize={8} fill={MUTED}>Paramètres</text>
      <rect x={20} y={56} width={160} height={10} rx={5} fill="hsl(var(--muted))" />
      <rect x={20} y={74} width={120} height={10} rx={5} fill="hsl(var(--muted))" />
      <text x={160} y={186} textAnchor="middle" fontSize={7.5} fill={MUTED}>Illustration — l’emplacement varie selon le navigateur</text>
    </svg>
  );
}

/* ---------- Notifications ---------- */
function AllowPrompt() {
  return (
    <Phone label="Illustration : fenêtre du navigateur, bouton Autoriser">
      <Lines y={40} />
      <rect x={18} y={110} width={124} height={86} rx={12} fill={CARD} stroke={BORDER} />
      <text x={28} y={130} fontSize={8} fontWeight={700} fill={MUTED}>BCA Messenger souhaite</text>
      <text x={28} y={142} fontSize={8} fontWeight={700} fill={MUTED}>envoyer des notifications</text>
      <rect x={28} y={160} width={48} height={22} rx={6} fill="hsl(var(--muted))" />
      <text x={52} y={174} textAnchor="middle" fontSize={8} fill={MUTED}>Refuser</text>
      <rect x={84} y={160} width={48} height={22} rx={6} fill={P} />
      <text x={108} y={174} textAnchor="middle" fontSize={8} fontWeight={700} fill="hsl(var(--primary-foreground))">Autoriser</text>
      <Ring x={80} y={156} w={56} h={30} />
      <Badge x={136} y={152} n={2} />
    </Phone>
  );
}
function AppButton() {
  return (
    <Phone label="Illustration : bouton Activer les notifications dans l’application">
      <rect x={18} y={40} width={124} height={50} rx={10} fill="hsl(var(--muted))" />
      <rect x={28} y={66} width={80} height={16} rx={8} fill={P} />
      <text x={68} y={77} textAnchor="middle" fontSize={7} fontWeight={700} fill="hsl(var(--primary-foreground))">Activer</text>
      <Ring x={24} y={62} w={88} h={24} />
      <Badge x={116} y={60} n={1} />
      <Lines y={110} />
    </Phone>
  );
}
function SiteSettings({ device }: { device: GuideDevice }) {
  const ios = device === "ios";
  return (
    <Phone label={ios ? "Illustration : Réglages, Notifications, BCA Messenger" : "Illustration : cadenas de la barre d’adresse, Autorisations"}>
      {ios ? (
        <>
          <text x={22} y={46} fontSize={10} fontWeight={700} fill={MUTED}>Réglages</text>
          {["Wi-Fi", "Notifications", "Sons"].map((t, i) => (
            <g key={t}><rect x={18} y={58 + i * 28} width={124} height={22} rx={6} fill="hsl(var(--muted))" />
              <text x={26} y={72 + i * 28} fontSize={8} fontWeight={i === 1 ? 700 : 400} fill={i === 1 ? P : MUTED}>{t}</text></g>
          ))}
          <Ring x={15} y={83} w={130} h={28} /><Badge x={142} y={82} n={1} />
          <rect x={18} y={160} width={124} height={26} rx={6} fill="hsl(var(--muted))" />
          <text x={26} y={176} fontSize={8} fill={MUTED}>Autoriser</text>
          <rect x={114} y={166} width={22} height={13} rx={6.5} fill={P} /><circle cx={129} cy={172.5} r={5} fill={CARD} />
          <Ring x={108} y={161} w={32} h={24} r={8} /><Badge x={142} y={158} n={2} />
          <text x={80} y={204} textAnchor="middle" fontSize={7} fill={MUTED}>dans « BCA Messenger »</text>
        </>
      ) : (
        <>
          <rect x={22} y={34} width={116} height={16} rx={8} fill="hsl(var(--muted))" />
          <g stroke={P} strokeWidth={1.4} fill="none"><rect x={28} y={41} width={8} height={6} rx={1} /><path d="M30 41 v-2 a2 2 0 0 1 4 0 v2" /></g>
          <Ring x={22} y={32} w={20} h={20} r={6} /><Badge x={20} y={62} n={1} />
          <rect x={18} y={70} width={124} height={92} rx={10} fill={CARD} stroke={BORDER} />
          <text x={28} y={88} fontSize={8} fill={MUTED}>Autorisations</text>
          <text x={28} y={112} fontSize={8} fontWeight={700} fill={P}>Notifications</text>
          <rect x={110} y={103} width={22} height={13} rx={6.5} fill={P} /><circle cx={125} cy={109.5} r={5} fill={CARD} />
          <Ring x={22} y={98} w={116} h={22} r={6} /><Badge x={140} y={96} n={2} />
        </>
      )}
    </Phone>
  );
}

type Step = { art: ReactNode; text: string };

function stepsFor(topic: GuideTopic, device: GuideDevice): { title: string; steps: Step[]; note?: string } {
  if (topic === "install" || topic === "notify-ios") {
    if (device === "ios") {
      const steps: Step[] = [
        { art: <IosStep1 />, text: "Dans Safari, touchez Partager (carré avec flèche)." },
        { art: <IosStep2 />, text: "Choisissez « Sur l’écran d’accueil »." },
        { art: <IosStep3 />, text: "Touchez « Ajouter » en haut à droite." },
        { art: <IosStep4 />, text: "Ouvrez BCA Messenger depuis l’icône créée." },
      ];
      if (topic === "notify-ios") steps.push({ art: <AppButton />, text: "Dans l’app installée, touchez « Activer », puis « Autoriser »." });
      return {
        title: topic === "install" ? "Installer sur iPhone ou iPad" : "Notifications sur iPhone ou iPad",
        steps,
        note: "Apple n’autorise les notifications Web que pour les sites ajoutés à l’écran d’accueil, avec iOS ou iPadOS 16.4 ou plus récent. Depuis l’onglet Safari, la demande ne peut pas s’afficher.",
      };
    }
    if (device === "android") return {
      title: "Installer sur Android",
      steps: [
        { art: <AndroidStep1 />, text: "Ouvrez le menu du navigateur (trois points)." },
        { art: <AndroidStep2 />, text: "Choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil »." },
        { art: <AndroidStep3 />, text: "Confirmez avec « Installer »." },
      ],
      note: "Option absente ? Ouvrez le site dans Chrome, Edge ou Samsung Internet à jour.",
    };
    return {
      title: "Installer sur ordinateur",
      steps: [{ art: <DesktopIllustration />, text: "Cliquez sur l’icône d’installation de la barre d’adresse (1) ou ouvrez le menu (2) puis « Installer BCA Messenger »." }],
      note: "Firefox et certaines versions de Safari ne proposent pas l’installation : le chat reste utilisable dans le navigateur, ou utilisez Chrome ou Edge à jour.",
    };
  }
  if (topic === "notify-denied") return {
    title: "Débloquer les notifications",
    steps: [
      { art: <SiteSettings device={device} />, text: device === "ios"
        ? "Ouvrez Réglages > Notifications > BCA Messenger (1), puis activez « Autoriser » (2)."
        : "Touchez le cadenas à gauche de l’adresse (1), puis activez Notifications (2)." },
      { art: <AppButton />, text: "Revenez ici et touchez « Réessayer »." },
    ],
    note: "Un site Web ne peut pas ouvrir ces réglages à votre place : la modification doit être faite manuellement.",
  };
  return {
    title: "Navigateur non compatible",
    steps: device === "desktop"
      ? [{ art: <DesktopIllustration />, text: "Ouvrez BCA Messenger dans Chrome, Edge, Firefox ou Safari à jour, puis installez-le si possible." }]
      : [
        { art: <AndroidStep1 />, text: "Ouvrez le site dans Chrome ou Samsung Internet à jour, puis le menu." },
        { art: <AllowPrompt />, text: "Touchez « Activer » puis « Autoriser » dans la fenêtre du navigateur." },
      ],
    note: "Certains navigateurs intégrés (dans d’autres apps) ne gèrent pas les notifications.",
  };
}

export function DeviceGuide({ topic, device = detectDevice() }: { topic: GuideTopic; device?: GuideDevice }) {
  const { title, steps, note } = stepsFor(topic, device);
  return (
    <section className="rounded-2xl border border-primary/15 bg-muted/40 p-3 sm:p-4" data-testid={`device-guide-${topic}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">Illustration</span>
      </div>
      <ol className={`grid gap-3 ${steps.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
        {steps.map((s, i) => (
          <li key={i} className="flex flex-col items-center gap-2 rounded-xl bg-card p-2 text-center">
            {s.art}
            <p className="text-xs leading-snug text-muted-foreground"><span className="font-semibold text-foreground">{i + 1}. </span>{s.text}</p>
          </li>
        ))}
      </ol>
      {note && <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{note}</p>}
    </section>
  );
}
