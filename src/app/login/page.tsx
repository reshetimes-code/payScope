import { signIn } from '@/lib/auth';
import { Logo } from '@/components/logo';

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="text-center">
        <div className="flex justify-center">
          <Logo className="scale-125" />
        </div>
        <p className="mt-4 text-sm text-stone-400">
          מערכת פנימית להצגת עלויות והגבלת תקציב. גישה מוגבלת לאדמין בלבד.
        </p>
      </div>
      <form
        action={async () => {
          'use server';
          await signIn('google', { redirectTo: '/dashboard' });
        }}
      >
        <button
          type="submit"
          className="rounded-md bg-black px-6 py-3 text-white transition-colors hover:bg-purple-700"
        >
          התחברות עם Google
        </button>
      </form>
    </main>
  );
}
