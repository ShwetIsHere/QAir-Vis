import React from 'react';
import ReactTestRenderer, { type ReactTestInstance } from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { SupabaseClient } from '@supabase/supabase-js';
import AuthScreen from '../src/components/AuthScreen';

const auth = {
  signInWithPassword: jest.fn(),
  signUp: jest.fn(),
  resetPasswordForEmail: jest.fn(),
};

const client = { auth } as unknown as SupabaseClient;

function renderAuth() {
  const holder: { current?: ReactTestRenderer.ReactTestRenderer } = {};
  ReactTestRenderer.act(() => {
    holder.current = ReactTestRenderer.create(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 400, height: 800 },
          insets: { top: 24, left: 0, right: 0, bottom: 24 },
        }}
      >
        <AuthScreen client={client} />
      </SafeAreaProvider>,
    );
  });
  if (!holder.current) {
    throw new Error('Auth screen did not render.');
  }
  return holder.current;
}

function submitButton(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findByProps({ testID: 'auth-submit' }) as ReactTestInstance;
}

beforeEach(() => {
  jest.clearAllMocks();
  auth.signInWithPassword.mockResolvedValue({ error: null });
  auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
});

test('validates email before calling Supabase', async () => {
  const renderer = renderAuth();

  ReactTestRenderer.act(() => {
    renderer.root.findAllByType(TextInput)[0].props.onChangeText('invalid');
  });
  await ReactTestRenderer.act(async () => {
    await submitButton(renderer).props.onPress();
  });

  expect(auth.signInWithPassword).not.toHaveBeenCalled();
  expect(
    renderer.root.findAllByType(Text).some(
      (node) => node.props.children === 'Enter a valid email address.',
    ),
  ).toBe(true);
});

test('signs in with the entered email and password', async () => {
  const renderer = renderAuth();
  const [email, password] = renderer.root.findAllByType(TextInput);

  ReactTestRenderer.act(() => {
    email.props.onChangeText('person@example.com');
  });
  ReactTestRenderer.act(() => {
    password.props.onChangeText('safe-password');
  });
  await ReactTestRenderer.act(async () => {
    await submitButton(renderer).props.onPress();
  });

  expect(auth.signInWithPassword).toHaveBeenCalledWith({
    email: 'person@example.com',
    password: 'safe-password',
  });
});
