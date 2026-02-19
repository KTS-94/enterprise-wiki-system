/**
 * @modified from Docmost (AGPL-3.0)
 * @see https://github.com/docmost/docmost
 *
 * 페이지 비밀번호 모달, 그룹웨어 메시지 연동
 */
import {
  Modal,
  Button,
  Group,
  Text,
  PasswordInput,
  Stack,
} from "@mantine/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { verifyPagePassword } from "@/features/page/services/page-service";
import { IconLock } from "@tabler/icons-react";
import i18n from "@/i18n";

interface PagePasswordModalProps {
  pageId: string;
  open: boolean;
  onSuccess: (content: any) => void; // content 전달
}

export default function PagePasswordModal({
  pageId,
  open,
  onSuccess,
}: PagePasswordModalProps) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 그룹웨어 메시지 표시
  const showGwMessage = (message: string, type: "info" | "warn" = "info") => {
    try {
      if (type === "warn") {
        // @ts-ignore
        window.parent?.WIKIInbound?.warnMessage?.(message);
      } else {
        // @ts-ignore
        window.parent?.WIKIInbound?.infoMessage?.(message);
      }
    } catch (e) {
      console.warn("GW message call failed", e);
    }
  };

  const handleSubmit = async () => {
    if (!password.trim()) {
      setError(t("Please enter a password"));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await verifyPagePassword({ pageId, password });

      if (result.verified) {
        // 중요: content와 함께 onSuccess 호출
        // 그룹웨어에서 showGwMessage 호출 시 iframe이 재로드될 수 있으므로
        // sessionStorage에 먼저 저장해야 재로드 시에도 인증 상태가 유지됨
        onSuccess(result.content);
        setPassword("");
        showGwMessage(i18n.t("Password verified successfully"), "info");
      } else {
        setError(t("Invalid password. Please try again."));
      }
    } catch (err: any) {
      setError(err.response?.data?.message || t("An error occurred"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSubmit();
    }
  };

  return (
    <Modal.Root
      opened={open}
      onClose={() => {}} // 닫기 불가 (비밀번호 입력 필수)
      size={400}
      padding="xl"
      yOffset={20}
      xOffset={0}
      closeOnClickOutside={false}
      closeOnEscape={false}
    >
      <Modal.Overlay backgroundOpacity={0} />
      <Modal.Content>
        <Modal.Header py={0}>
          <Group gap="xs">
            <IconLock size={20} />
            <Modal.Title fw={500}>
              {t("Password protected page")}
            </Modal.Title>
          </Group>
        </Modal.Header>
        <Modal.Body>
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              {t("This page is protected.")}
              <br />
              {t("Enter the password to view the content.")}
            </Text>

            <PasswordInput
              label={t("Password")}
              placeholder={t("Enter password")}
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              onKeyDown={handleKeyDown}
              error={error}
              autoFocus
              data-autofocus
              autoComplete="one-time-code"
              name="page-access-code"
              data-lpignore="true"
              data-form-type="other"
            />

            <Group justify="end" mt="xs">
              <Button onClick={handleSubmit} loading={isLoading}>
                {t("Unlock")}
              </Button>
            </Group>
          </Stack>
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
