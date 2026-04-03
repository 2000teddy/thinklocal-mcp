declare module '@niomon/spake2' {
  interface SpakeSuite {
    Verifier: new (password: Buffer, idS: Buffer, idP: Buffer) => SpakeVerifier;
    Prover: new (password: Buffer, idS: Buffer, idP: Buffer) => SpakeProver;
  }

  interface SpakeVerifier {
    generate(): Buffer;
    finish(inMessage: Buffer): Buffer;
  }

  interface SpakeProver {
    generate(): Buffer;
    finish(inMessage: Buffer): Buffer;
  }

  export const spake2: {
    SPAKE2_ED25519_SHA256_HKDF_HMAC: SpakeSuite;
  };
}
