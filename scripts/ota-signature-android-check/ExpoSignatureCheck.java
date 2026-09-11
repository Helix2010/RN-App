import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.security.PublicKey;
import java.security.Signature;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Base64;
import java.util.List;

/**
 * Runs exactly what expo-updates runs on the device, no more:
 *
 *   CertificateChain.kt   constructCertificate()   -> CertificateFactory + checkValidity()
 *   CertificateChain.kt   isCodeSigningCertificate -> keyUsage[0] && EKU contains 1.3.6.1.5.5.7.3.3
 *   CodeSigningConfiguration.kt:93-96              -> Signature.getInstance("SHA256withRSA")
 *
 * Built to run under dalvikvm on the emulator so the X.509 parsing and the RSA
 * verify happen on Android's own Conscrypt, not on a desktop JCA that merely
 * resembles it.
 *
 * args: <certificate.pem> <signed-body-file> <signature-base64-file>
 */
public class ExpoSignatureCheck {
  private static final String CODE_SIGNING_OID = "1.3.6.1.5.5.7.3.3";

  public static void main(String[] args) throws Exception {
    byte[] pem = Files.readAllBytes(Paths.get(args[0]));
    byte[] body = Files.readAllBytes(Paths.get(args[1]));
    String signatureBase64 = new String(Files.readAllBytes(Paths.get(args[2]))).trim();

    System.out.println("runtime      = " + System.getProperty("java.vm.name") + " "
        + System.getProperty("java.vm.version"));

    X509Certificate certificate = (X509Certificate) CertificateFactory.getInstance("X.509")
        .generateCertificate(new ByteArrayInputStream(pem));

    boolean validity = true;
    try {
      certificate.checkValidity();
    } catch (Exception failure) {
      validity = false;
      System.out.println("checkValidity FAILED: " + failure);
    }

    boolean[] keyUsage = certificate.getKeyUsage();
    boolean digitalSignature = keyUsage != null && keyUsage.length > 0 && keyUsage[0];

    List<String> extended = certificate.getExtendedKeyUsage();
    boolean codeSigning = extended != null && extended.contains(CODE_SIGNING_OID);

    PublicKey publicKey = certificate.getPublicKey();
    Signature verifier = Signature.getInstance("SHA256withRSA");
    verifier.initVerify(publicKey);
    verifier.update(body);
    boolean signatureValid = verifier.verify(Base64.getDecoder().decode(signatureBase64));

    // A signature that still verifies after the payload changed would mean we are
    // not actually signing the bytes the client reads.
    byte[] tampered = body.clone();
    tampered[tampered.length / 2] ^= 0x01;
    Signature tamperCheck = Signature.getInstance("SHA256withRSA");
    tamperCheck.initVerify(publicKey);
    tamperCheck.update(tampered);
    boolean tamperedRejected = !tamperCheck.verify(Base64.getDecoder().decode(signatureBase64));

    System.out.println("subject                = " + certificate.getSubjectX500Principal());
    System.out.println("publicKey              = " + publicKey.getAlgorithm());
    System.out.println("checkValidity          = " + validity);
    System.out.println("keyUsage[0]            = " + digitalSignature);
    System.out.println("EKU codeSigning        = " + codeSigning);
    System.out.println("isCodeSigningCert      = " + (digitalSignature && codeSigning));
    System.out.println("signature verifies     = " + signatureValid);
    System.out.println("tampered body rejected = " + tamperedRejected);

    boolean ok = validity && digitalSignature && codeSigning && signatureValid && tamperedRejected;
    System.out.println(ok ? "RESULT: ACCEPTED" : "RESULT: REJECTED");
    System.exit(ok ? 0 : 1);
  }
}
