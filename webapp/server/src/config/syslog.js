import dgram from 'node:dgram';
import net from 'node:net';
import os from 'node:os';
import env from './env.js';

/**
 * Minimal dependency-free syslog client supporting RFC 5424 (default) and
 * RFC 3164 framing over UDP or TCP (octet-counted, per RFC 6587).
 *
 * Enterprise SIEM collectors (rsyslog, syslog-ng, Splunk UF, QRadar) accept
 * both; RFC 5424 is preferred because it carries structured data elements.
 */

export const SEVERITY = {
  emerg: 0,
  alert: 1,
  crit: 2,
  error: 3,
  warning: 4,
  notice: 5,
  info: 6,
  debug: 7,
};

const NIL = '-';

const escapeSdValue = (value) =>
  String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/]/g, '\\]');

const sanitizeToken = (value, fallback = NIL) => {
  const cleaned = String(value ?? '').replace(/[^\x21-\x7e]/g, '');
  return cleaned.length ? cleaned.slice(0, 48) : fallback;
};

export const buildStructuredData = (sdId, fields = {}) => {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (!entries.length) return NIL;
  const params = entries.map(([k, v]) => `${sanitizeToken(k, 'field')}="${escapeSdValue(v)}"`).join(' ');
  return `[${sdId} ${params}]`;
};

export const formatRfc5424 = ({
  facility,
  severity,
  timestamp = new Date(),
  hostname,
  appName,
  procId,
  msgId,
  structuredData = NIL,
  message = '',
}) => {
  const priority = facility * 8 + severity;
  return (
    `<${priority}>1 ${timestamp.toISOString()} ${sanitizeToken(hostname)} ${sanitizeToken(appName)} ` +
    `${sanitizeToken(procId)} ${sanitizeToken(msgId)} ${structuredData} \uFEFF${message}`
  );
};

export const formatRfc3164 = ({ facility, severity, timestamp = new Date(), hostname, appName, procId, message }) => {
  const priority = facility * 8 + severity;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(timestamp.getDate()).padStart(2, ' ');
  const time = timestamp.toTimeString().slice(0, 8);
  const stamp = `${months[timestamp.getMonth()]} ${day} ${time}`;
  return `<${priority}>${stamp} ${sanitizeToken(hostname)} ${sanitizeToken(appName)}[${sanitizeToken(procId, '0')}]: ${message}`;
};

class SyslogClient {
  constructor(options = {}) {
    this.options = {
      enabled: env.syslog.enabled,
      host: env.syslog.host,
      port: env.syslog.port,
      protocol: env.syslog.protocol,
      facility: env.syslog.facility,
      appName: env.syslog.appName,
      hostname: env.syslog.hostname || os.hostname(),
      rfc: env.syslog.rfc,
      ...options,
    };
    this.procId = String(process.pid);
    this.socket = null;
    this.tcpSocket = null;
    this.tcpReady = false;
    this.pending = [];
    this.dropped = 0;
    this.sent = 0;
    this.lastError = null;
  }

  get enabled() {
    return this.options.enabled;
  }

  format(entry) {
    const base = {
      facility: this.options.facility,
      severity: entry.severity ?? SEVERITY.info,
      timestamp: entry.timestamp ?? new Date(),
      hostname: this.options.hostname,
      appName: this.options.appName,
      procId: this.procId,
      msgId: entry.msgId || NIL,
      structuredData: entry.structuredData || NIL,
      message: entry.message || '',
    };
    return this.options.rfc === '3164' ? formatRfc3164(base) : formatRfc5424(base);
  }

  send(entry) {
    if (!this.enabled) return false;
    const payload = this.format(entry);
    try {
      if (this.options.protocol === 'tcp') this.#sendTcp(payload);
      else this.#sendUdp(payload);
      this.sent += 1;
      return true;
    } catch (error) {
      this.dropped += 1;
      this.lastError = error.message;
      return false;
    }
  }

  #sendUdp(payload) {
    if (!this.socket) {
      this.socket = dgram.createSocket('udp4');
      this.socket.on('error', (error) => {
        this.lastError = error.message;
        this.socket?.close();
        this.socket = null;
      });
      this.socket.unref();
    }
    const buffer = Buffer.from(payload, 'utf8');
    this.socket.send(buffer, 0, buffer.length, this.options.port, this.options.host, (error) => {
      if (error) {
        this.dropped += 1;
        this.lastError = error.message;
      }
    });
  }

  #sendTcp(payload) {
    // RFC 6587 octet counting keeps multi-line messages intact on stream transports.
    const buffer = Buffer.from(payload, 'utf8');
    const framed = Buffer.concat([Buffer.from(`${buffer.length} `, 'utf8'), buffer]);
    if (this.tcpReady && this.tcpSocket) {
      this.tcpSocket.write(framed);
      return;
    }
    if (this.pending.length < 1000) this.pending.push(framed);
    this.#ensureTcpSocket();
  }

  #ensureTcpSocket() {
    if (this.tcpSocket) return;
    this.tcpSocket = net.createConnection({ host: this.options.host, port: this.options.port });
    this.tcpSocket.unref();
    this.tcpSocket.setKeepAlive(true, 30_000);
    this.tcpSocket.on('connect', () => {
      this.tcpReady = true;
      const queued = this.pending.splice(0, this.pending.length);
      for (const frame of queued) this.tcpSocket.write(frame);
    });
    const teardown = (error) => {
      if (error) this.lastError = error.message;
      this.tcpReady = false;
      this.tcpSocket?.destroy();
      this.tcpSocket = null;
      // Reconnect lazily on the next send; never crash the app because the SIEM is down.
    };
    this.tcpSocket.on('error', teardown);
    this.tcpSocket.on('close', () => teardown());
  }

  stats() {
    return {
      enabled: this.enabled,
      target: `${this.options.protocol}://${this.options.host}:${this.options.port}`,
      rfc: this.options.rfc,
      facility: this.options.facility,
      sent: this.sent,
      dropped: this.dropped,
      lastError: this.lastError,
    };
  }

  close() {
    this.socket?.close();
    this.socket = null;
    this.tcpSocket?.destroy();
    this.tcpSocket = null;
    this.tcpReady = false;
  }
}

export const syslogClient = new SyslogClient();
export { SyslogClient };
export default syslogClient;
