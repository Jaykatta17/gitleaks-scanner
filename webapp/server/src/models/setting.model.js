import mongoose from 'mongoose';

/**
 * Runtime-editable platform settings. Secrets (SMTP password, LDAP bind password)
 * stay in the environment — this collection only holds operational toggles.
 */
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
    description: { type: String, default: '' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export const Setting = mongoose.model('Setting', settingSchema);
export default Setting;
