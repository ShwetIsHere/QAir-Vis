import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { SupabaseClient } from '@supabase/supabase-js';

type AuthMode = 'sign-in' | 'sign-up' | 'reset-password';

type AuthScreenProps = {
  client: SupabaseClient;
};

export default function AuthScreen({ client }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>('sign-in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const isSignUp = mode === 'sign-up';
  const isReset = mode === 'reset-password';
  const title = isSignUp
    ? 'Create Account'
    : isReset
      ? 'Reset Password'
      : 'Welcome Back';
  const subtitle = isSignUp
    ? 'Join us to start tracking your asthma triggers'
    : isReset
      ? 'We’ll email you a link to reset your password'
      : 'Sign in to continue monitoring your asthma triggers';

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError('');
    setMessage('');
  }

  async function submit() {
    setError('');
    setMessage('');

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError('Enter your email address.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (isSignUp && !name.trim()) {
      setError('Enter your full name.');
      return;
    }
    if (!isReset && password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (isSignUp && password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      if (isReset) {
        const { error: resetError } =
          await client.auth.resetPasswordForEmail(normalizedEmail);
        if (resetError) {
          setError(resetError.message);
        } else {
          setMessage('Password reset email sent. Check your inbox.');
        }
      } else if (isSignUp) {
        const { data, error: signUpError } = await client.auth.signUp({
          email: normalizedEmail,
          password,
          options: { data: { full_name: name.trim() } },
        });
        if (signUpError) {
          setError(signUpError.message);
        } else if (!data.session) {
          setEmail(normalizedEmail);
          setPassword('');
          setConfirmPassword('');
          setMode('sign-in');
          setMessage('Account created. Check your email to confirm, then sign in.');
        }
      } else {
        const { error: signInError } = await client.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });
        if (signInError) {
          setError(signInError.message);
        }
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Unable to reach the authentication service. Try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <LinearGradient
      colors={['#0b1020', '#111a2e', '#1c2a40']}
      style={styles.screen}
    >
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <View style={styles.iconCircle}>
              <Text style={styles.icon}>{isSignUp ? '✚' : '♥'}</Text>
            </View>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>
          </View>

          <View style={styles.card}>
            {isSignUp && (
              <FormField
                label="Full Name"
                placeholder="Enter your full name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                editable={!busy}
              />
            )}

            <FormField
              label="Email Address"
              placeholder="Enter your email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              editable={!busy}
            />

            {!isReset && (
              <FormField
                label="Password"
                placeholder={isSignUp ? 'Create a password' : 'Enter your password'}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!passwordVisible}
                autoCapitalize="none"
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                editable={!busy}
                trailing={
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      passwordVisible ? 'Hide password' : 'Show password'
                    }
                    onPress={() => setPasswordVisible(!passwordVisible)}
                    hitSlop={10}
                  >
                    <Text style={styles.visibility}>{passwordVisible ? '◉' : '⊘'}</Text>
                  </Pressable>
                }
              />
            )}

            {isSignUp && (
              <FormField
                label="Confirm Password"
                placeholder="Confirm your password"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!confirmPasswordVisible}
                autoCapitalize="none"
                autoComplete="new-password"
                editable={!busy}
                trailing={
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      confirmPasswordVisible
                        ? 'Hide confirm password'
                        : 'Show confirm password'
                    }
                    onPress={() =>
                      setConfirmPasswordVisible(!confirmPasswordVisible)
                    }
                    hitSlop={10}
                  >
                    <Text style={styles.visibility}>
                      {confirmPasswordVisible ? '◉' : '⊘'}
                    </Text>
                  </Pressable>
                }
              />
            )}

            {!isSignUp && !isReset && (
              <Pressable
                style={styles.forgotButton}
                onPress={() => changeMode('reset-password')}
              >
                <Text style={styles.forgotText}>Forgot Password?</Text>
              </Pressable>
            )}

            {!!error && <Text style={styles.error}>{error}</Text>}
            {!!message && <Text style={styles.message}>{message}</Text>}

            <Pressable
              accessibilityRole="button"
              disabled={busy}
              testID="auth-submit"
              onPress={submit}
              style={({ pressed }) => [
                styles.submitButton,
                pressed && !busy && styles.pressed,
                busy && styles.disabled,
              ]}
            >
              <LinearGradient
                colors={['#39c9a7', '#4b9ef5']}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.submitGradient}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitText}>
                    {isSignUp ? 'Sign Up' : isReset ? 'Send Reset Link' : 'Sign In'}
                  </Text>
                )}
              </LinearGradient>
            </Pressable>
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>
              {isSignUp
                ? 'Already have an account? '
                : isReset
                  ? 'Remember your password? '
                  : 'Don’t have an account? '}
            </Text>
            <Pressable
              onPress={() =>
                changeMode(isSignUp || isReset ? 'sign-in' : 'sign-up')
              }
            >
              <Text style={styles.switchLink}>
                {isSignUp || isReset ? 'Sign In' : 'Sign Up'}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

type FormFieldProps = {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  editable: boolean;
  keyboardType?: 'default' | 'email-address';
  autoCapitalize?: 'none' | 'words';
  autoComplete?: 'email' | 'new-password' | 'current-password';
  secureTextEntry?: boolean;
  trailing?: ReactNode;
};

function FormField({
  label,
  placeholder,
  value,
  onChangeText,
  editable,
  keyboardType = 'default',
  autoCapitalize = 'none',
  autoComplete,
  secureTextEntry,
  trailing,
}: FormFieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputFrame}>
        <TextInput
          accessibilityLabel={label}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          editable={editable}
          keyboardType={keyboardType}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#8993a6"
          secureTextEntry={secureTextEntry}
          style={styles.input}
          value={value}
        />
        {trailing}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  keyboard: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 32,
  },
  header: { alignItems: 'center', marginBottom: 28 },
  iconCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#ffffff16',
    borderWidth: 1,
    borderColor: '#ffffff24',
    marginBottom: 20,
  },
  icon: { color: '#55aaff', fontSize: 36, fontWeight: '700' },
  title: { color: '#edf2ff', fontSize: 27, fontWeight: '700' },
  subtitle: {
    color: '#aeb8ca',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 8,
    maxWidth: 330,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#77839b66',
    backgroundColor: '#ffffff12',
    padding: 18,
  },
  field: { marginBottom: 14 },
  label: { color: '#c4ccdc', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  inputFrame: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#8792a766',
    backgroundColor: '#ffffff12',
    paddingHorizontal: 13,
  },
  input: { flex: 1, minHeight: 46, color: '#f5f7fc', fontSize: 15 },
  visibility: { color: '#aeb8ca', fontSize: 19, paddingLeft: 10 },
  forgotButton: { alignSelf: 'flex-end', marginTop: -4, marginBottom: 18 },
  forgotText: { color: '#55aaff', fontSize: 14, fontWeight: '600' },
  error: {
    color: '#ffb2b2',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  message: {
    color: '#72e1c2',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  submitButton: { overflow: 'hidden', borderRadius: 28, marginTop: 4 },
  submitGradient: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.65 },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
  },
  switchText: { color: '#aeb8ca', fontSize: 14 },
  switchLink: { color: '#42d2b0', fontSize: 14, fontWeight: '700' },
});
