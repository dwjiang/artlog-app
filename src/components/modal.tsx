import { Modal as NativeModal, type ModalProps } from "react-native";

const ORIENTATIONS: ModalProps["supportedOrientations"] = ["portrait", "landscape-left", "landscape-right"];

/** React Native's modal allows only portrait by default and would turn a landscape screen upright when it opens. */
export function Modal(props: ModalProps) {
  return <NativeModal supportedOrientations={ORIENTATIONS} {...props} />;
}
