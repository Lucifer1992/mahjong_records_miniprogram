// components/login-drawer/login-drawer.ts
// 全局登录抽屉：登录主体 + 完善资料 二级抽屉
import { wxLogin, setToken, uploadAvatar, updateProfile } from '../../utils/api';
import { setTier } from '../../utils/tier';
import { bootSync } from '../../utils/sync';
import { getRecords, ensureMe, renameMe } from '../../utils/storage';

Component({
  data: {
    visible: false,            // 主登录抽屉
    profileVisible: false,     // 完善资料子抽屉
    loading: false,
    avatarPath: '',
    nickname: ''
  },

  methods: {
    /** 页面通过 selectComponent('#loginDrawer').show() 拉起主抽屉 */
    show() {
      if (this.data.visible || this.data.profileVisible) return;
      this.setData({ visible: true });
    },

    hide() {
      this.setData({ visible: false });
    },

    onMaskTap() {
      this.hide();
    },

    noop() { /* 挡抽屉内冒泡 */ },

    /** 微信一键登录：wx.login → 后端换 token；成功后再弹完善资料抽屉 */
    async onLoginTap() {
      if (this.data.loading) return;
      this.setData({ loading: true });

      try {
        const loginRes = await new Promise<WechatMiniprogram.LoginRes>((resolve, reject) => {
          wx.login({ success: resolve, fail: reject });
        });
        if (!loginRes.code) throw new Error('wx.login 未返回 code');

        const result = await wxLogin(loginRes.code);
        setToken(result.token);
        if (result.user && result.user.tier) setTier(result.user.tier);

        wx.showToast({ title: '登录成功', icon: 'success', duration: 600 });

        // 建好本地「我」的玩家档案（绑定 myPlayerId），供后续 onAddMe 使用
        ensureMe();

        // 首次同步不阻塞 UI
        bootSync(getRecords()).catch(() => { /* 静默 */ });

        // 关主抽屉，弹完善资料子抽屉
        setTimeout(() => {
          this.setData({ visible: false });
          this.setData({ profileVisible: true });
          this.triggerEvent('loggedin');
        }, 400);
      } catch (e: any) {
        console.warn('[login-drawer] 登录失败', e);
        wx.showToast({ title: '登录失败，请重试', icon: 'none' });
      } finally {
        this.setData({ loading: false });
      }
    },

    /** 用户主动关闭主抽屉（点 ✕ 或遮罩）：跳过完善资料 */
    onProfileMaskTap() {
      this.skipProfile();
    },

    skipProfile() {
      this.setData({ profileVisible: false, avatarPath: '', nickname: '' });
    },

    /** 完善资料：用户点选头像 + 填昵称 → 保存到云端 */
    async onSaveProfile() {
      if (!this.data.avatarPath && !this.data.nickname) {
        // 没填直接跳过
        this.skipProfile();
        return;
      }
      try {
        if (this.data.avatarPath) {
          const { url: avatarUrl } = await uploadAvatar(this.data.avatarPath);
          await updateProfile({ nickname: this.data.nickname || undefined, avatar: avatarUrl });
        } else if (this.data.nickname) {
          await updateProfile({ nickname: this.data.nickname });
        }

        // 同步昵称到本地档案（确保 onAddMe 显示正确昵称而非默认"我"）
        if (this.data.nickname) {
          renameMe(this.data.nickname);
        }
        wx.showToast({ title: '已保存', icon: 'success', duration: 600 });
      } catch (e) {
        console.warn('[login-drawer] 资料保存失败', e);
        wx.showToast({ title: '保存失败，请稍后再试', icon: 'none' });
      } finally {
        this.skipProfile();
      }
    },

    /** 微信官方头像填写能力 */
    onChooseAvatar(e: { detail: { avatarUrl: string } }) {
      if (e.detail && e.detail.avatarUrl) {
        this.setData({ avatarPath: e.detail.avatarUrl });
      }
    },

    onNicknameInput(e: { detail: { value: string } }) {
      this.setData({ nickname: (e.detail.value || '').trim() });
    },

    onPrivacyTap() {
      wx.navigateTo({ url: '/pages/agreement/privacy' });
    },

    onTermsTap() {
      wx.navigateTo({ url: '/pages/agreement/terms' });
    }
  }
});